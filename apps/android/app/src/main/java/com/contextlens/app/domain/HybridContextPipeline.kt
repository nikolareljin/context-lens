package com.contextlens.app.domain

import com.contextlens.app.context.DateResolver
import com.contextlens.app.context.SessionContext
import com.contextlens.app.context.SessionContextManager
import com.contextlens.app.diagnostics.CallLog
import com.contextlens.app.diagnostics.CallRecord
import com.contextlens.app.diagnostics.Tier
import com.contextlens.app.diagnostics.redact
import java.net.URLEncoder
import java.time.LocalDate
import java.time.format.TextStyle
import java.util.Locale
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

enum class Stage {
    /** Dropped by the Tier 0 rules; no model was called. */
    FILTERED,
    GATEKEEPING,
    /** The gatekeeper found no checkable claim. */
    NO_CLAIM,
    /** Strict mode without the on-device model: the sentence stays on the phone unchecked. */
    NEEDS_MODEL,
    /** The query still carried personal data, so it was not sent. */
    WITHHELD,
    VERIFYING,
    /** The cloud refused for quota or billing; the clean question can still be searched by the user. */
    CLOUD_UNAVAILABLE,
    DONE,
    FAILED,
}

data class GateInfo(val result: GatekeeperResult, val model: String, val source: String?, val latencyMs: Long)

/** One sentence on its way through the pipeline. The raw text stays in memory only. */
data class Check(
    val id: Long,
    val utterance: String,
    val atMillis: Long,
    val stage: Stage,
    val gate: GateInfo? = null,
    val card: FactCard? = null,
    val withheld: Set<PiiKind> = emptySet(),
    val note: String? = null,
    /** Fed by the demo script, not spoken or typed; the card says so. */
    val demo: Boolean = false,
    /** The sentence and its context went to the cloud gatekeeper (or may have); recorded in the ledger. */
    val sentToCloud: Boolean = false,
)

data class PipelineCounts(
    val processed: Int = 0,
    val filtered: Int = 0,
    val withheld: Int = 0,
    /** Sentences that only the phone read: stopped by the local rules or read by the on-device model. */
    val readOnPhone: Int = 0,
    /** Sentences the cloud may have read (Balanced fallback, or a Strict reply that came from the cloud). */
    val readInCloud: Int = 0,
    /** Bytes of sentence and context sent this session; the ledger has each request. */
    val rawBytes: Int = 0,
    /** Sentences that got a grounded verdict. */
    val checked: Int = 0,
)

data class PipelinePrompts(val gatekeeper: Prompt, val verifier: Prompt)

/** The models the pipeline uses; Firebase AI Logic in the app, fakes in tests. */
interface ModelSource {
    fun gatekeeper(mode: PrivacyMode): TextModel

    /** Grounded cloud verifiers, in the order to try. */
    fun verifiers(): List<TextModel>

    /** False when the on-device model is known to be missing or still downloading. */
    fun onDeviceReady(): Boolean

    /** Called with the verifier that answered, so it is tried first next time. */
    fun verifierAnswered(name: String) {}
}

/**
 * Sentence → Tier 0 rules → on-device gatekeeper → personal-data check →
 * grounded cloud verifier → verdict rules. Sentences are processed one at a
 * time, in order. Every request that leaves the phone goes into [ledger].
 */
class HybridContextPipeline(
    private val scope: CoroutineScope,
    private val session: SessionContextManager,
    private val models: ModelSource,
    private val prompts: PipelinePrompts,
    val ledger: EgressLedger,
    private val callLog: CallLog? = null,
    private val clock: () -> Long = System::currentTimeMillis,
    private val gateTimeoutMs: Long = GATE_TIMEOUT_MS,
    private val verifyTimeoutMs: Long = VERIFY_TIMEOUT_MS,
    /** Waits before asking the phone's model again after it refused for its usage quota (Strict). */
    private val quotaBackoffMs: List<Long> = QUOTA_BACKOFF_MS,
    private val pause: suspend (Long) -> Unit = { delay(it) },
) {
    private val _checks = MutableStateFlow<List<Check>>(emptyList())
    /** Newest first, at most [CHECKS_MAX]. */
    val checks: StateFlow<List<Check>> = _checks.asStateFlow()

    private val _counts = MutableStateFlow(PipelineCounts())
    val counts: StateFlow<PipelineCounts> = _counts.asStateFlow()

    private val _mode = MutableStateFlow(PrivacyMode.STRICT)
    val mode: StateFlow<PrivacyMode> = _mode.asStateFlow()

    private class Work(val id: Long, val text: String, val context: SessionContext, val mode: PrivacyMode, val session: Long)

    private val queue = Channel<Work>(Channel.UNLIMITED)
    private val ids = AtomicLong(0)
    /** Goes up with every [clear]; work from an earlier session no longer changes the counters. */
    private val sessions = AtomicLong(0)
    @Volatile private var current: Job? = null

    init {
        scope.launch {
            for (work in queue) {
                // Started only once it is [current], so clear() always reaches the running sentence.
                val job = scope.launch(start = CoroutineStart.LAZY) { process(work) }
                current = job
                job.start()
                job.join()
            }
        }
    }

    fun setMode(mode: PrivacyMode) {
        _mode.value = mode
    }

    /** Takes one finished sentence (spoken, typed or from the demo script). Returns its id, or null for blank text. */
    fun submit(text: String, demo: Boolean = false): Long? {
        val clean = text.trim().replace(Regex("\\s+"), " ")
        if (clean.isEmpty()) return null
        // The context as it was before this sentence: "recent" means the sentences before it.
        val context = session.state.value
        session.addUtterance(clean)
        val id = ids.incrementAndGet()
        _counts.update { it.copy(processed = it.processed + 1) }
        when (val decision = Tier0Filter.check(clean)) {
            is Tier0Filter.Decision.Drop -> {
                put(Check(id, clean, clock(), Stage.FILTERED, note = decision.reason, demo = demo))
                _counts.update { it.copy(filtered = it.filtered + 1, readOnPhone = it.readOnPhone + 1) }
            }
            Tier0Filter.Decision.Pass -> {
                put(Check(id, clean, clock(), Stage.GATEKEEPING, demo = demo))
                queue.trySend(Work(id, clean, context, _mode.value, sessions.get()))
            }
        }
        return id
    }

    /** Forgets every sentence and stops the one in progress. The ledger is kept. */
    fun clear() {
        while (queue.tryReceive().isSuccess) {
            // drop queued sentences
        }
        current?.cancel()
        _checks.value = emptyList()
        sessions.incrementAndGet()
        _counts.value = PipelineCounts()
    }

    /** Counts for [session] only if it is still the current one. */
    private fun count(session: Long, change: (PipelineCounts) -> PipelineCounts) {
        if (sessions.get() == session) _counts.update(change)
    }

    private fun put(check: Check) = _checks.update { (listOf(check) + it).take(CHECKS_MAX) }

    private fun update(id: Long, change: (Check) -> Check) =
        _checks.update { list -> list.map { if (it.id == id) change(it) else it } }

    private suspend fun process(work: Work) {
        try {
            // Switching to Strict also covers sentences queued before the switch.
            val mode = if (_mode.value == PrivacyMode.STRICT) PrivacyMode.STRICT else work.mode
            val gate = gatekeep(work, mode) ?: return
            if (!gate.result.hasVerifiableClaim) {
                // Counters first, so they are up to date whenever a card shows its final stage.
                if (gate.source == ON_DEVICE) count(work.session) { it.copy(filtered = it.filtered + 1) }
                update(work.id) { it.copy(stage = Stage.NO_CLAIM, gate = gate) }
                return
            }
            val publicNames = listOfNotNull(work.context.pinnedTopic, work.context.region?.label())
            val hits = PiiPostScrubber.findIn(gate.result.sanitizedResolvedQuery, work.text, publicNames, work.context.recent)
            if (hits.isNotEmpty()) {
                count(work.session) { it.copy(withheld = it.withheld + 1) }
                update(work.id) { it.copy(stage = Stage.WITHHELD, gate = gate, withheld = hits) }
                return
            }
            update(work.id) { it.copy(stage = Stage.VERIFYING, gate = gate) }
            verify(work.id, work.session, gate.result.sanitizedResolvedQuery)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            update(work.id) { it.copy(stage = Stage.FAILED, note = e.describe()) }
        }
    }

    private suspend fun gatekeep(work: Work, mode: PrivacyMode): GateInfo? {
        if (mode == PrivacyMode.STRICT && !models.onDeviceReady()) {
            count(work.session) { it.copy(readOnPhone = it.readOnPhone + 1) }
            update(work.id) { it.copy(stage = Stage.NEEDS_MODEL) }
            return null
        }
        val model = models.gatekeeper(mode)
        val prompt = gatekeeperPrompt(prompts.gatekeeper, work.context, work.text)
        val start = clock()
        val promptBytes = EgressLedger.bytesOf(prompt)
        fun rawText(source: String?, label: String, inSession: Boolean = true) {
            ledger.add(
                EgressEntry(
                    start, EgressKind.RAW_TEXT, "gatekeeper", model.name, prompt, promptBytes,
                    source, clock() - start, prompts.gatekeeper.version, label,
                ),
            )
            // A call stopped by Clear belongs to the session that just ended; its card is gone.
            if (inSession) {
                count(work.session) { it.copy(readInCloud = it.readInCloud + 1, rawBytes = it.rawBytes + promptBytes) }
                update(work.id) { it.copy(sentToCloud = true) }
            }
        }
        // Balanced can fall back to the cloud, so a call stopped midway may already have been sent.
        suspend fun attempt() = call(gateTimeoutMs, onCancel = { if (mode == PrivacyMode.BALANCED) rawText(null, MAYBE_SENT, inSession = false) }) {
            model.generate(prompt)
        }
        var outcome = attempt()
        // Android limits how often one app may call the phone's model. In Strict a refusal
        // never left the phone, so asking again later is safe; Balanced is not retried, since
        // the call may already have gone to the cloud.
        for (wait in quotaBackoffMs) {
            val error = outcome.error
            if (mode != PrivacyMode.STRICT || error == null || !GatekeeperEval.isQuota(error)) break
            update(work.id) { it.copy(note = "the phone's model is busy; trying again in ${wait / 1000} s") }
            pause(wait)
            outcome = attempt()
        }
        if (outcome.reply != null) update(work.id) { it.copy(note = null) }
        val latency = clock() - start
        val reply = outcome.reply
        val tier = if (reply?.source == ON_DEVICE || (mode == PrivacyMode.STRICT && reply == null)) Tier.ON_DEVICE else Tier.CLOUD
        // Strict without a reply never left the phone (on device only); a Balanced call without one may have.
        if (tier == Tier.ON_DEVICE) count(work.session) { it.copy(readOnPhone = it.readOnPhone + 1) }
        callLog?.add(CallRecord(start, tier, "gatekeeper ${model.name}", reply?.source, latency, outcome.label))
        if (mode == PrivacyMode.STRICT && reply != null && reply.source != ON_DEVICE) {
            // Strict asked for the phone only; a reply from anywhere else is recorded and not used.
            rawText(reply.source, "${outcome.label}; not on the device in Strict mode")
            update(work.id) { it.copy(stage = Stage.FAILED, note = "gatekeeper did not run on the device") }
            return null
        }
        // Unless the reply says it ran on the phone, count a Balanced call as sent.
        if (mode == PrivacyMode.BALANCED && reply?.source != ON_DEVICE) {
            rawText(reply?.source, if (reply == null) "${outcome.label}; may have been sent" else outcome.label)
        }
        if (reply == null) {
            update(work.id) { it.copy(stage = Stage.FAILED, note = "gatekeeper: ${outcome.label}") }
            return null
        }
        val result = GatekeeperParser.parse(reply.text)
        if (result == null) {
            update(work.id) { it.copy(stage = Stage.FAILED, note = "gatekeeper reply was not valid") }
            return null
        }
        return GateInfo(result, model.name, reply.source, latency)
    }

    private suspend fun verify(id: Long, session: Long, query: String) {
        val prompt = prompts.verifier.fill(mapOf("query" to query))
        val bytes = EgressLedger.bytesOf(prompt)
        var lastLabel = "no cloud model configured"
        for (model in models.verifiers()) {
            val start = clock()
            val sent = { label: String, reply: ModelReply? ->
                ledger.add(
                    EgressEntry(
                        start, EgressKind.CLEAN_QUERY, "verifier", model.name, prompt, bytes,
                        reply?.source, clock() - start, prompts.verifier.version, label,
                    ),
                )
            }
            val outcome = call(verifyTimeoutMs, onCancel = { sent(MAYBE_SENT, null) }) { model.generate(prompt) }
            val latency = clock() - start
            val reply = outcome.reply
            sent(outcome.label, reply)
            callLog?.add(CallRecord(start, Tier.CLOUD, "verifier ${model.name}", reply?.source, latency, outcome.label))
            if (reply != null && !reply.text.isNullOrBlank()) {
                models.verifierAnswered(model.name)
                val card = VerdictRules.card(reply, model.name, latency)
                count(session) { it.copy(checked = it.checked + 1) }
                update(id) { it.copy(stage = Stage.DONE, card = card) }
                return
            }
            lastLabel = outcome.label
            // Quota and billing are per project: the next model would be refused the same way.
            if (isCloudLimit(outcome.label)) {
                update(id) { it.copy(stage = Stage.CLOUD_UNAVAILABLE, note = outcome.label) }
                return
            }
        }
        update(id) { it.copy(stage = Stage.FAILED, note = "verifier: $lastLabel") }
    }

    private class Outcome(val reply: ModelReply?, val label: String, val error: Throwable? = null)

    /**
     * [onCancel] runs when the pipeline is stopped mid-call (Clear), before the
     * cancellation goes on. A cancellation from inside the call (the SDK's own timeout)
     * is an ordinary failure, so the sentence still ends in a final state.
     */
    private suspend fun call(timeoutMs: Long, onCancel: () -> Unit, block: suspend () -> ModelReply): Outcome = try {
        val reply = withTimeoutOrNull(timeoutMs) { block() }
        when {
            reply == null -> Outcome(null, "timed out")
            reply.text.isNullOrBlank() -> Outcome(reply, "ok, empty reply")
            else -> Outcome(reply, "ok")
        }
    } catch (e: CancellationException) {
        if (currentCoroutineContext().isActive) {
            Outcome(null, e.describe())
        } else {
            onCancel()
            throw e
        }
    } catch (e: Exception) {
        // A failure delivered after Clear is a cancellation too, so nothing counts it in the new session.
        if (currentCoroutineContext().isActive) {
            Outcome(null, e.describe(), e)
        } else {
            onCancel()
            throw CancellationException("cleared").apply { initCause(e) }
        }
    }

    companion object {
        const val CHECKS_MAX = 30
        const val GATE_TIMEOUT_MS = 15_000L
        const val VERIFY_TIMEOUT_MS = 30_000L
        val QUOTA_BACKOFF_MS = listOf(5_000L, 15_000L)
        const val ON_DEVICE = "ON_DEVICE"
        const val MAYBE_SENT = "cancelled; may have been sent"
    }
}

private val cloudLimit = Regex("(?i)quota|billing|prepay|RESOURCE_EXHAUSTED|\\b402\\b|\\b429\\b")

/** True when a cloud failure means quota, rate limit or billing rather than a broken request. */
fun isCloudLimit(outcome: String): Boolean = cloudLimit.containsMatchIn(outcome)

/** A Google search for the clean question, opened in the user's own browser; nothing is sent by the app. */
fun searchUrl(query: String): String = "https://www.google.com/search?q=" + URLEncoder.encode(query, Charsets.UTF_8.name())

/** The gatekeeper prompt for one sentence; the app and the evaluation use the same one. */
fun gatekeeperPrompt(template: Prompt, context: SessionContext, text: String): String = template.fill(
    mapOf(
        "context" to context.preamble(),
        "hints" to dateHint(text, context.today),
        "utterance" to text.replace('"', '\''),
    ),
)

/** A line for the gatekeeper prompt with the date a phrase like "last month" means. */
fun dateHint(text: String, today: LocalDate): String {
    val m = DateResolver.resolve(text, today) ?: return "Date hint: none"
    return "Date hint: \"${m.phrase}\" = ${describeRange(m.start, m.end)}"
}

fun describeRange(start: LocalDate, end: LocalDate): String = when {
    start == end -> "$start"
    start.dayOfMonth == 1 && end == start.withDayOfMonth(start.lengthOfMonth()) ->
        "${start.month.getDisplayName(TextStyle.FULL, Locale.US)} ${start.year}"
    start.dayOfYear == 1 && end == start.withDayOfYear(start.lengthOfYear()) -> "${start.year}"
    else -> "$start to $end"
}

private fun Throwable.describe(): String =
    "${javaClass.simpleName}: ${redact(message?.lineSequence()?.firstOrNull()?.take(160) ?: "no message")}"

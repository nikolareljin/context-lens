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
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
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
)

data class PipelineCounts(val processed: Int = 0, val filtered: Int = 0, val withheld: Int = 0)

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
) {
    private val _checks = MutableStateFlow<List<Check>>(emptyList())
    /** Newest first, at most [CHECKS_MAX]. */
    val checks: StateFlow<List<Check>> = _checks.asStateFlow()

    private val _counts = MutableStateFlow(PipelineCounts())
    val counts: StateFlow<PipelineCounts> = _counts.asStateFlow()

    private val _mode = MutableStateFlow(PrivacyMode.STRICT)
    val mode: StateFlow<PrivacyMode> = _mode.asStateFlow()

    private class Work(val id: Long, val text: String, val context: SessionContext, val mode: PrivacyMode)

    private val queue = Channel<Work>(Channel.UNLIMITED)
    private val ids = AtomicLong(0)
    private var current: Job? = null

    init {
        scope.launch {
            for (work in queue) {
                val job = scope.launch { process(work) }
                current = job
                job.join()
            }
        }
    }

    fun setMode(mode: PrivacyMode) {
        _mode.value = mode
    }

    /** Takes one finished sentence (spoken or typed). Returns its id, or null for blank text. */
    fun submit(text: String): Long? {
        val clean = text.trim().replace(Regex("\\s+"), " ")
        if (clean.isEmpty()) return null
        // The context as it was before this sentence: "recent" means the sentences before it.
        val context = session.state.value
        session.addUtterance(clean)
        val id = ids.incrementAndGet()
        _counts.update { it.copy(processed = it.processed + 1) }
        when (val decision = Tier0Filter.check(clean)) {
            is Tier0Filter.Decision.Drop -> {
                put(Check(id, clean, clock(), Stage.FILTERED, note = decision.reason))
                _counts.update { it.copy(filtered = it.filtered + 1) }
            }
            Tier0Filter.Decision.Pass -> {
                put(Check(id, clean, clock(), Stage.GATEKEEPING))
                queue.trySend(Work(id, clean, context, _mode.value))
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
        _counts.value = PipelineCounts()
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
                update(work.id) { it.copy(stage = Stage.NO_CLAIM, gate = gate) }
                if (gate.source == ON_DEVICE) _counts.update { it.copy(filtered = it.filtered + 1) }
                return
            }
            val publicNames = listOfNotNull(work.context.pinnedTopic, work.context.region?.label())
            val hits = PiiPostScrubber.findIn(gate.result.sanitizedResolvedQuery, work.text, publicNames, work.context.recent)
            if (hits.isNotEmpty()) {
                update(work.id) { it.copy(stage = Stage.WITHHELD, gate = gate, withheld = hits) }
                _counts.update { it.copy(withheld = it.withheld + 1) }
                return
            }
            update(work.id) { it.copy(stage = Stage.VERIFYING, gate = gate) }
            verify(work.id, gate.result.sanitizedResolvedQuery)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            update(work.id) { it.copy(stage = Stage.FAILED, note = e.describe()) }
        }
    }

    private suspend fun gatekeep(work: Work, mode: PrivacyMode): GateInfo? {
        if (mode == PrivacyMode.STRICT && !models.onDeviceReady()) {
            update(work.id) { it.copy(stage = Stage.NEEDS_MODEL) }
            return null
        }
        val model = models.gatekeeper(mode)
        val prompt = prompts.gatekeeper.fill(
            mapOf(
                "context" to work.context.preamble(),
                "hints" to dateHint(work.text, work.context.today),
                "utterance" to work.text.replace('"', '\''),
            ),
        )
        val start = clock()
        fun rawText(source: String?, label: String) = ledger.add(
            EgressEntry(
                start, EgressKind.RAW_TEXT, "gatekeeper", model.name, prompt, EgressLedger.bytesOf(prompt),
                source, clock() - start, prompts.gatekeeper.version, label,
            ),
        )
        // Balanced can fall back to the cloud, so a call stopped midway may already have been sent.
        val outcome = call(gateTimeoutMs, onCancel = { if (mode == PrivacyMode.BALANCED) rawText(null, MAYBE_SENT) }) {
            model.generate(prompt)
        }
        val latency = clock() - start
        val reply = outcome.reply
        val tier = if (reply?.source == ON_DEVICE || (mode == PrivacyMode.STRICT && reply == null)) Tier.ON_DEVICE else Tier.CLOUD
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

    private suspend fun verify(id: Long, query: String) {
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

    private class Outcome(val reply: ModelReply?, val label: String)

    /** [onCancel] runs when the pipeline is stopped mid-call (Clear), before the cancellation goes on. */
    private suspend fun call(timeoutMs: Long, onCancel: () -> Unit, block: suspend () -> ModelReply): Outcome = try {
        val reply = withTimeoutOrNull(timeoutMs) { block() }
        when {
            reply == null -> Outcome(null, "timed out")
            reply.text.isNullOrBlank() -> Outcome(reply, "ok, empty reply")
            else -> Outcome(reply, "ok")
        }
    } catch (e: CancellationException) {
        onCancel()
        throw e
    } catch (e: Exception) {
        Outcome(null, e.describe())
    }

    companion object {
        const val CHECKS_MAX = 30
        const val GATE_TIMEOUT_MS = 15_000L
        const val VERIFY_TIMEOUT_MS = 30_000L
        const val ON_DEVICE = "ON_DEVICE"
        const val MAYBE_SENT = "cancelled; may have been sent"
    }
}

private val cloudLimit = Regex("(?i)quota|billing|prepay|RESOURCE_EXHAUSTED|\\b402\\b|\\b429\\b")

/** True when a cloud failure means quota, rate limit or billing rather than a broken request. */
fun isCloudLimit(outcome: String): Boolean = cloudLimit.containsMatchIn(outcome)

/** A Google search for the clean question, opened in the user's own browser; nothing is sent by the app. */
fun searchUrl(query: String): String = "https://www.google.com/search?q=" + URLEncoder.encode(query, Charsets.UTF_8.name())

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

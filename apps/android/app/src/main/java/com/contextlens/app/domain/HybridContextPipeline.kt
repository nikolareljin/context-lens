package com.contextlens.app.domain

import com.contextlens.app.context.DateResolver
import com.contextlens.app.context.SessionContext
import com.contextlens.app.context.SessionContextManager
import com.contextlens.app.diagnostics.CallLog
import com.contextlens.app.diagnostics.CallRecord
import com.contextlens.app.diagnostics.Tier
import com.contextlens.app.diagnostics.redact
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
            val gate = gatekeep(work) ?: return
            if (!gate.result.hasVerifiableClaim) {
                update(work.id) { it.copy(stage = Stage.NO_CLAIM, gate = gate) }
                _counts.update { it.copy(filtered = it.filtered + 1) }
                return
            }
            val publicNames = listOfNotNull(work.context.pinnedTopic, work.context.region?.label())
            val hits = PiiPostScrubber.findIn(gate.result.sanitizedResolvedQuery, work.text, publicNames)
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

    private suspend fun gatekeep(work: Work): GateInfo? {
        if (work.mode == PrivacyMode.STRICT && !models.onDeviceReady()) {
            update(work.id) { it.copy(stage = Stage.NEEDS_MODEL) }
            return null
        }
        val model = models.gatekeeper(work.mode)
        val prompt = prompts.gatekeeper.fill(
            mapOf(
                "context" to work.context.preamble(),
                "hints" to dateHint(work.text, work.context.today),
                "utterance" to work.text.replace('"', '\''),
            ),
        )
        val start = clock()
        val outcome = call(gateTimeoutMs) { model.generate(prompt) }
        val latency = clock() - start
        val reply = outcome.reply
        val tier = if (work.mode == PrivacyMode.STRICT || reply?.source == ON_DEVICE) Tier.ON_DEVICE else Tier.CLOUD
        callLog?.add(CallRecord(start, tier, "gatekeeper ${model.name}", reply?.source, latency, outcome.label))
        // Balanced can fall back to the cloud; unless the reply says it ran on the phone, count it as sent.
        if (work.mode == PrivacyMode.BALANCED && reply?.source != ON_DEVICE) {
            ledger.add(
                EgressEntry(
                    start, EgressKind.RAW_TEXT, "gatekeeper", model.name, prompt, EgressLedger.bytesOf(prompt),
                    reply?.source, latency, prompts.gatekeeper.version,
                    if (reply == null) "${outcome.label}; may have been sent" else outcome.label,
                ),
            )
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
            val outcome = call(verifyTimeoutMs) { model.generate(prompt) }
            val latency = clock() - start
            val reply = outcome.reply
            ledger.add(
                EgressEntry(
                    start, EgressKind.CLEAN_QUERY, "verifier", model.name, prompt, bytes,
                    reply?.source, latency, prompts.verifier.version, outcome.label,
                ),
            )
            callLog?.add(CallRecord(start, Tier.CLOUD, "verifier ${model.name}", reply?.source, latency, outcome.label))
            if (reply != null && !reply.text.isNullOrBlank()) {
                models.verifierAnswered(model.name)
                val card = VerdictRules.card(reply, model.name, latency)
                update(id) { it.copy(stage = Stage.DONE, card = card) }
                return
            }
            lastLabel = outcome.label
        }
        update(id) { it.copy(stage = Stage.FAILED, note = "verifier: $lastLabel") }
    }

    private class Outcome(val reply: ModelReply?, val label: String)

    private suspend fun call(timeoutMs: Long, block: suspend () -> ModelReply): Outcome = try {
        val reply = withTimeoutOrNull(timeoutMs) { block() }
        when {
            reply == null -> Outcome(null, "timed out")
            reply.text.isNullOrBlank() -> Outcome(reply, "ok, empty reply")
            else -> Outcome(reply, "ok")
        }
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        Outcome(null, e.describe())
    }

    companion object {
        const val CHECKS_MAX = 30
        const val GATE_TIMEOUT_MS = 15_000L
        const val VERIFY_TIMEOUT_MS = 30_000L
        const val ON_DEVICE = "ON_DEVICE"
    }
}

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

package com.contextlens.app.domain

import com.contextlens.app.context.Region
import com.contextlens.app.context.SessionContext
import java.time.LocalDate
import java.time.Month
import java.util.Locale
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.withTimeoutOrNull
import org.snakeyaml.engine.v2.api.Load
import org.snakeyaml.engine.v2.api.LoadSettings

/** One labelled sentence from eval/utterances.yaml. */
data class EvalItem(
    val id: String,
    val split: String,
    val text: String,
    val context: SessionContext,
    val claim: Boolean,
    val refs: List<String> = emptyList(),
    val forbid: List<String> = emptyList(),
    val queryHas: List<String> = emptyList(),
) {
    val scored: Boolean get() = split == "test"
}

/** Reads the evaluation set: synthetic sentences with the expected gatekeeper answer. */
object EvalSet {
    fun parse(yaml: String): List<EvalItem> {
        val root = Load(LoadSettings.builder().build()).loadFromString(yaml) as Map<*, *>
        val defaults = root["defaults"] as? Map<*, *> ?: emptyMap<Any, Any>()
        return (root["items"] as List<*>).map { raw ->
            val m = raw as Map<*, *>
            val ctx = m["context"] as? Map<*, *> ?: emptyMap<Any, Any>()
            fun setting(key: String): String? = (ctx[key] ?: defaults[key])?.toString()
            EvalItem(
                id = m["id"].toString(),
                split = m["split"].toString(),
                text = m["text"].toString(),
                context = SessionContext(
                    today = month(setting("date") ?: "November 2026"),
                    region = setting("region")?.let { Region(it, "", "") },
                    pinnedTopic = setting("pinned"),
                    recent = strings(ctx["rolling"]),
                ),
                claim = m["claim"] as Boolean,
                refs = strings(m["refs"]),
                forbid = strings(m["forbid"]),
                queryHas = strings(m["query_has"]),
            )
        }
    }

    private fun strings(value: Any?): List<String> = (value as? List<*>)?.map { it.toString() }.orEmpty()

    /** "November 2026" → the 16th of that month, so "last month" and "this year" are unambiguous. */
    internal fun month(text: String): LocalDate {
        val (name, year) = text.trim().split(Regex("\\s+"))
        return LocalDate.of(year.toInt(), Month.valueOf(name.uppercase(Locale.US)), 16)
    }
}

/** What the gatekeeper did with one sentence, and how that compares to the label. */
data class EvalResult(
    val item: EvalItem,
    /** null when the call failed or the reply could not be read. */
    val claim: Boolean?,
    val query: String,
    val refs: List<String>,
    val source: String?,
    val latencyMs: Long,
    val error: String? = null,
    /** Planted values the model left in the question. */
    val modelLeaks: List<String> = emptyList(),
    /** Of those, the ones the personal-data check would not have stopped: these would be sent. */
    val sentLeaks: List<String> = emptyList(),
    val refsFound: Int = 0,
    val queryHasFound: Int = 0,
)

/** Scores over the test split. */
data class EvalSummary(
    val scored: Int,
    val failed: Int,
    val truePositives: Int,
    val falsePositives: Int,
    val falseNegatives: Int,
    val refsFound: Int,
    val refsExpected: Int,
    val queryHasFound: Int,
    val queryHasExpected: Int,
    val modelLeaks: Int,
    val sentLeaks: Int,
    val medianLatencyMs: Long?,
    val sources: Map<String, Int>,
) {
    val precision: Double? get() = ratio(truePositives, truePositives + falsePositives)
    val recall: Double? get() = ratio(truePositives, truePositives + falseNegatives)

    private fun ratio(a: Int, b: Int): Double? = if (b == 0) null else a.toDouble() / b
}

/**
 * Runs the gatekeeper over the evaluation set, one sentence at a time, with the same
 * prompt the app uses. Nothing here sends anything itself: in the app the model is the
 * Strict (on device only) gatekeeper, and the cloud verifier is never called.
 */
class GatekeeperEval(
    private val model: TextModel,
    private val prompt: Prompt,
    private val clock: () -> Long = System::currentTimeMillis,
    private val timeoutMs: Long = 20_000,
) {
    suspend fun run(items: List<EvalItem>, onProgress: (done: Int, total: Int) -> Unit = { _, _ -> }): List<EvalResult> {
        val scored = items.filter { it.scored }
        return scored.mapIndexed { i, item -> one(item).also { onProgress(i + 1, scored.size) } }
    }

    private suspend fun one(item: EvalItem): EvalResult {
        val start = clock()
        val reply = try {
            withTimeoutOrNull(timeoutMs) { model.generate(gatekeeperPrompt(prompt, item.context, item.text)) }
                ?: return EvalResult(item, null, "", emptyList(), null, clock() - start, error = "timed out")
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            return EvalResult(item, null, "", emptyList(), null, clock() - start, error = e.javaClass.simpleName)
        }
        val latency = clock() - start
        val result = GatekeeperParser.parse(reply.text)
            ?: return EvalResult(item, null, "", emptyList(), reply.source, latency, error = "reply was not valid")
        return score(item, result, reply.source, latency)
    }

    companion object {
        /** Compares one gatekeeper answer with its label; also used by the JVM tests. */
        fun score(item: EvalItem, result: GatekeeperResult, source: String?, latencyMs: Long): EvalResult {
            val query = if (result.hasVerifiableClaim) result.sanitizedResolvedQuery else ""
            val leaks = item.forbid.filter { contains(query, it) }
            val publicNames = listOfNotNull(item.context.pinnedTopic, item.context.region?.label())
            val stopped = leaks.isNotEmpty() &&
                PiiPostScrubber.findIn(query, item.text, publicNames, item.context.recent).isNotEmpty()
            val refsText = result.resolvedReferences.joinToString(" | ")
            return EvalResult(
                item = item,
                claim = result.hasVerifiableClaim,
                query = query,
                refs = result.resolvedReferences,
                source = source,
                latencyMs = latencyMs,
                modelLeaks = leaks,
                sentLeaks = if (stopped) emptyList() else leaks,
                refsFound = item.refs.count { contains(refsText, it) },
                queryHasFound = if (result.hasVerifiableClaim) item.queryHas.count { contains(query, it) } else 0,
            )
        }

        /**
         * Case-insensitive, with "→" read as "->". Words match whole ("Sam" is not in
         * "same"); in numbers, spaces and dashes are ignored ("4111111111111111").
         */
        internal fun contains(haystack: String, needle: String): Boolean {
            fun norm(s: String) = s.lowercase(Locale.US).replace("→", "->").replace(Regex("\\s+"), " ")
            fun digitsOnly(s: String) = s.replace(Regex("[\\s-]"), "")
            val h = norm(haystack)
            val n = norm(needle)
            if (Regex("(?<![\\p{L}\\p{N}])" + Regex.escape(n) + "(?![\\p{L}\\p{N}])").containsMatchIn(h)) return true
            return n.any(Char::isDigit) && digitsOnly(h).contains(digitsOnly(n))
        }

        /**
         * A failed call on a labelled claim counts as a missed claim, so failures can't
         * raise recall. References and expected words are scored on every labelled
         * claim, and on the questions written for claims that were found.
         */
        fun summarize(results: List<EvalResult>): EvalSummary {
            val answered = results.filter { it.claim != null }
            val found = answered.filter { it.claim == true && it.item.claim }
            val latencies = answered.map { it.latencyMs }.sorted()
            return EvalSummary(
                scored = results.size,
                failed = results.size - answered.size,
                truePositives = found.size,
                falsePositives = answered.count { it.claim == true && !it.item.claim },
                falseNegatives = results.count { it.item.claim && it.claim != true },
                refsFound = results.sumOf { it.refsFound },
                refsExpected = results.sumOf { it.item.refs.size },
                queryHasFound = found.sumOf { it.queryHasFound },
                queryHasExpected = found.sumOf { it.item.queryHas.size },
                modelLeaks = results.sumOf { it.modelLeaks.size },
                sentLeaks = results.sumOf { it.sentLeaks.size },
                medianLatencyMs = latencies.getOrNull(latencies.size / 2),
                sources = results.groupingBy { it.source ?: "none" }.eachCount(),
            )
        }

        /** A plain-text report to paste into docs/evaluation.md; synthetic sentences only. */
        fun report(results: List<EvalResult>, header: String, promptVersion: String): String = buildString {
            val s = summarize(results)
            fun pct(v: Double?) = v?.let { String.format(Locale.US, "%.0f%%", it * 100) } ?: "n/a"
            appendLine("ContextLens gatekeeper evaluation")
            appendLine(header)
            appendLine("Prompt $promptVersion · ${s.scored} test sentences · ${s.failed} failed")
            appendLine("Claim precision ${pct(s.precision)} · recall ${pct(s.recall)} (TP ${s.truePositives}, FP ${s.falsePositives}, FN ${s.falseNegatives})")
            appendLine("References resolved ${s.refsFound}/${s.refsExpected} · expected words in the questions for found claims ${s.queryHasFound}/${s.queryHasExpected}")
            appendLine("Personal data: ${s.modelLeaks} left in a question by the model, ${s.sentLeaks} would have been sent")
            appendLine("Median latency ${s.medianLatencyMs?.let { "$it ms" } ?: "n/a"} · sources ${s.sources.entries.joinToString { "${it.key} ${it.value}" }}")
            appendLine()
            results.forEach { r ->
                val verdict = when {
                    r.error != null -> "ERROR ${r.error}"
                    r.sentLeaks.isNotEmpty() -> "LEAK ${r.sentLeaks}"
                    r.claim != r.item.claim -> "MISS expected claim=${r.item.claim}"
                    else -> "ok"
                }
                appendLine("${r.item.id} · $verdict · ${r.latencyMs} ms · ${r.source ?: "none"}")
                if (r.query.isNotEmpty()) appendLine("  query: ${r.query}")
                if (r.refs.isNotEmpty()) appendLine("  refs: ${r.refs.joinToString(" | ")}")
                if (r.modelLeaks.isNotEmpty() && r.sentLeaks.isEmpty()) appendLine("  stopped by the personal-data check: ${r.modelLeaks}")
            }
        }
    }
}

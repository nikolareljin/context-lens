package com.contextlens.app.domain

import java.io.File
import java.time.LocalDate
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The deterministic half of the evaluation (`./dev eval`): the parts of the pipeline
 * that don't need a model, checked against every sentence in eval/utterances.yaml,
 * and the scoring used by the on-device run.
 */
class GatekeeperEvalTest {
    private val items: List<EvalItem> by lazy {
        val path = System.getProperty("contextlens.evalSet") ?: error("contextlens.evalSet is not set")
        // The path is set by the Gradle test task.
        // foxguard: ignore[kt/no-path-traversal]
        EvalSet.parse(File(path).readText())
    }

    @Test
    fun theSetParsesWithUniqueIdsAndATestSplit() {
        assertTrue(items.size >= 70)
        assertEquals(items.size, items.map { it.id }.toSet().size)
        assertTrue(items.all { it.split == "train" || it.split == "test" })
        assertTrue(items.count { it.scored } >= 50)
        assertTrue(items.filter { it.id.startsWith("pii") }.all { it.forbid.isNotEmpty() })
        val dx01 = items.single { it.id == "dx01" }
        assertEquals(LocalDate.of(2026, 11, 16), dx01.context.today)
        assertEquals("Springfield", dx01.context.region?.city)
        assertEquals("city bus fares", dx01.context.pinnedTopic)
    }

    @Test
    fun theLocalRulesNeverDropALabelledClaim() {
        val dropped = items.filter { it.claim && Tier0Filter.check(it.text) is Tier0Filter.Decision.Drop }
        assertEquals(emptyList<String>(), dropped.map { it.id })
    }

    @Test
    fun theDateHintMatchesEveryLabelledDateReference() {
        val dateWords = listOf("last month", "this year", "last year")
        val misses = items.flatMap { item ->
            item.refs.filter { ref -> dateWords.any { ref.startsWith("$it ->") } }
                .filterNot { ref -> dateHint(item.text, item.context.today).contains(ref.substringAfter("-> ")) }
                .map { "${item.id}: $it" }
        }
        assertEquals(emptyList<String>(), misses)
    }

    /**
     * The backstop: if the model copied a planted value into the question, the
     * personal-data check must stop it, whatever the rest of the question says.
     */
    @Test
    fun thePersonalDataCheckStopsEveryPlantedValue() {
        val passed = items.flatMap { item ->
            val publicNames = listOfNotNull(item.context.pinnedTopic, item.context.region?.label())
            item.forbid.filter { value ->
                val query = "Is it true that $value is part of this story?"
                PiiPostScrubber.findIn(query, item.text, publicNames, item.context.recent).isEmpty()
            }.map { "${item.id}: $it" }
        }
        assertEquals(emptyList<String>(), passed)
    }

    @Test
    fun scoringCountsLeaksTheCheckWouldStopSeparately() {
        val item = items.single { it.id == "pii05" }
        val leaky = GatekeeperResult(true, "Did flu cases double in Springfield? Ask Dr. Patel", emptyList(), null)
        val r = GatekeeperEval.score(item, leaky, "ON_DEVICE", 900)
        assertEquals(listOf("Patel"), r.modelLeaks)
        assertEquals(emptyList<String>(), r.sentLeaks)

        val clean = GatekeeperResult(true, "Did flu cases double in Springfield in October 2026?", emptyList(), null)
        val ok = GatekeeperEval.score(item, clean, "ON_DEVICE", 800)
        assertTrue(ok.modelLeaks.isEmpty())
        assertEquals(1, ok.queryHasFound)
    }

    @Test
    fun aFailedCallOnAClaimCountsAsMissed() {
        val claim = items.single { it.id == "fc09" }
        val talk = items.single { it.id == "st05" }
        val results = listOf(
            EvalResult(claim, null, "", emptyList(), null, 20_000, error = "timed out"),
            GatekeeperEval.score(talk, GatekeeperResult(false, "", emptyList(), "small talk"), "ON_DEVICE", 500),
        )
        val s = GatekeeperEval.summarize(results)
        assertEquals(1, s.falseNegatives)
        assertEquals(0.0, s.recall!!, 0.0)
        assertEquals(null, s.precision)
    }

    @Test
    fun matchingIgnoresCaseArrowsAndNumberSpacing() {
        assertTrue(GatekeeperEval.contains("Here → Springfield", "here -> Springfield"))
        assertTrue(GatekeeperEval.contains("card 4111111111111111 charged", "4111 1111 1111 1111"))
        assertTrue(GatekeeperEval.contains("Is the EV credit still 7,500?", "7,500"))
        assertFalse(GatekeeperEval.contains("Did property tax rise?", "Jenna"))
        // Whole words only.
        assertFalse(GatekeeperEval.contains("Is the EV credit still the same 7,500 dollars?", "Sam"))
        assertFalse(GatekeeperEval.contains("Did the stock market fall?", "Mark"))
        assertTrue(GatekeeperEval.contains("Ask Mark about it", "Mark"))
        assertTrue(GatekeeperEval.contains("Did Springfield ban plastic bags?", "plastic bag"))
        assertTrue(GatekeeperEval.contains("Ask Kevin O’Brien", "O'Brien"))
        // Numbers match whole.
        assertFalse(GatekeeperEval.contains("Did 41110 drivers pay the toll?", "4111"))
        assertFalse(GatekeeperEval.contains("Is the credit 17,500 now?", "7,500"))
        assertTrue(GatekeeperEval.contains("Is the EV tax credit $7500?", "7,500"))
        assertFalse(GatekeeperEval.contains("Did rent at 112 Elm Street rise?", "12 Elm Street"))
    }

    @Test
    fun aRunScoresOnlyTheTestSplitAndReportsFailures() = runBlocking {
        var now = 0L
        val replies = mapOf(
            "Ugh, Mondays." to "{\"claim\": false, \"query\": \"\"}",
            "Python was first released in 1991." to "{\"claim\": true, \"query\": \"Was Python first released in 1991?\"}",
        )
        val model = object : TextModel {
            override val name = "fake"
            override suspend fun generate(prompt: String): ModelReply {
                now += 100
                val said = prompt.substringAfterLast("Sentence: \"").substringBeforeLast("\"")
                if (said.startsWith("Wait")) delay(1_000)
                return ModelReply(replies[said] ?: "not json", "ON_DEVICE")
            }
        }
        val prompt = Prompt("v1", "{{context}}\n{{hints}}\nSentence: \"{{utterance}}\"")
        val subset = items.filter { it.id in setOf("st01", "st05", "st06", "fc09") }
        val progress = mutableListOf<Int>()
        val results = GatekeeperEval(model, prompt, clock = { now }, timeoutMs = 200).run(subset) { done, _ -> progress += done }

        assertEquals(listOf("st05", "st06", "fc09"), results.map { it.item.id })
        assertEquals(listOf(1, 2, 3), progress)
        assertEquals("timed out", results[1].error)
        val s = GatekeeperEval.summarize(results)
        assertEquals(1, s.failed)
        assertEquals(1, s.truePositives)
        assertEquals(1.0, s.precision!!, 0.0)
        assertEquals(mapOf("ON_DEVICE" to 2, "none" to 1), s.sources)
        val report = GatekeeperEval.report(results, "test device", "v1")
        assertTrue(report.contains("Claim precision 100% · recall 100%"))
        assertTrue(report.contains("st06 · ERROR timed out"))
        assertEquals(mapOf("timed out" to 1), s.failures)
        assertTrue(report.contains("Failures: timed out ×1"))
    }

    @Test
    fun aQuotaRefusalIsRetriedAfterAWaitAndOnlyTheLastOneCounts() = runBlocking {
        val quota = "[ErrorCode 9] Request cannot be processed. Either your app is out of usage quota"
        var calls = 0
        val waits = mutableListOf<Long>()
        val model = object : TextModel {
            override val name = "fake"
            override suspend fun generate(prompt: String): ModelReply {
                calls++
                val said = prompt.substringAfterLast("Sentence: \"").substringBeforeLast("\"")
                if (said.startsWith("Python") && calls < 3) throw IllegalStateException(quota)
                if (said.startsWith("Lightning")) throw IllegalStateException(quota)
                return ModelReply("{\"claim\": true, \"query\": \"Was Python first released in 1991?\"}", "ON_DEVICE")
            }
        }
        val prompt = Prompt("v1", "{{context}}\n{{hints}}\nSentence: \"{{utterance}}\"")
        val run = GatekeeperEval(model, prompt, quotaBackoffMs = listOf(5, 15), pause = { waits += it })

        val ok = run.run(items.filter { it.id == "fc09" }).single()
        assertEquals(3, calls)
        assertEquals(listOf(5L, 15L), waits)
        assertEquals(true, ok.claim)

        calls = 0
        waits.clear()
        val refused = run.run(items.filter { it.id == "fc11" }).single()
        assertEquals(3, calls)
        assertEquals(null, refused.claim)
        assertTrue(refused.error!!.contains("usage quota"))
    }

    @Test
    fun failuresKeepTheExceptionMessageAndMissedClaimsAreListed() {
        var calls = 0
        val model = object : TextModel {
            override val name = "fake"
            override suspend fun generate(prompt: String): ModelReply {
                calls++
                val said = prompt.substringAfterLast("Sentence: \"").substringBeforeLast("\"")
                if (said.startsWith("Python")) throw IllegalStateException("model busy\nsecond line")
                return ModelReply("{\"claim\": false, \"query\": \"\"}", "ON_DEVICE")
            }
        }
        val prompt = Prompt("v1", "{{context}}\n{{hints}}\nSentence: \"{{utterance}}\"")
        val subset = items.filter { it.id in setOf("fc09") } + items.filter { it.scored && it.claim && it.id != "fc09" }.take(1)
        val results = runBlocking { GatekeeperEval(model, prompt, pause = { error("only quota refusals wait") }).run(subset) }
        assertEquals(2, calls)
        val s = GatekeeperEval.summarize(results)
        assertEquals(mapOf("IllegalStateException: model busy" to 1), s.failures)
        assertEquals(listOf(subset[1].id), s.missed)
        val report = GatekeeperEval.report(results, "test device", "v1")
        assertTrue(report.contains("Failures: IllegalStateException: model busy ×1"))
        assertTrue(report.contains("Missed claims: ${subset[1].id}"))
    }
}

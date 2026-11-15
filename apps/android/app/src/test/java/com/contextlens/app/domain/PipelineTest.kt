package com.contextlens.app.domain

import com.contextlens.app.context.Region
import com.contextlens.app.context.SessionContextManager
import com.contextlens.app.diagnostics.CallLog
import java.time.LocalDate
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PipelineTest {
    private val today = LocalDate.of(2026, 11, 14)
    private val prompts = PipelinePrompts(
        gatekeeper = Prompt("v1", "CTX[{{context}}] HINT[{{hints}}] SAY[{{utterance}}]"),
        verifier = Prompt("v1", "Check: {{query}}"),
    )
    private val source = Citation("Transit agency", "https://example.org/fares", "example.org")
    private val claimJson = "{\"claim\": true, \"query\": \"Did Springfield raise bus fares in October 2026?\", \"refs\": [\"here -> Springfield\"]}"

    private class FakeModel(
        override val name: String,
        private val answer: suspend (String) -> ModelReply,
    ) : TextModel {
        val prompts = mutableListOf<String>()
        override suspend fun generate(prompt: String): ModelReply {
            prompts += prompt
            return answer(prompt)
        }
    }

    private class FakeSource(
        val strict: FakeModel,
        val balanced: FakeModel,
        val verifiers: List<FakeModel>,
        var ready: Boolean = true,
    ) : ModelSource {
        val answered = mutableListOf<String>()
        override fun gatekeeper(mode: PrivacyMode): TextModel = if (mode == PrivacyMode.STRICT) strict else balanced
        override fun verifiers(): List<TextModel> = verifiers
        override fun onDeviceReady(): Boolean = ready
        override fun verifierAnswered(name: String) {
            answered += name
        }
    }

    private fun gate(json: String, source: String = "ON_DEVICE") = FakeModel("gate") { ModelReply(json, source) }

    private fun verifier(name: String = "v", text: String = "VERDICT: VERIFIED\nSUMMARY: Fares rose in October.") =
        FakeModel(name) { ModelReply(text, "IN_CLOUD", Grounding(listOf(source), listOf("springfield bus fares"), null)) }

    private class Harness(val pipeline: HybridContextPipeline, val session: SessionContextManager, val log: CallLog, val scope: CoroutineScope)

    private fun harness(models: ModelSource, verifyTimeoutMs: Long = 1_000): Harness {
        val session = SessionContextManager { today }
        val log = CallLog()
        val scope = CoroutineScope(kotlinx.coroutines.Dispatchers.Default + Job())
        val p = HybridContextPipeline(scope, session, models, prompts, EgressLedger(), log, verifyTimeoutMs = verifyTimeoutMs)
        return Harness(p, session, log, scope)
    }

    private val terminal = setOf(Stage.FILTERED, Stage.NO_CLAIM, Stage.NEEDS_MODEL, Stage.WITHHELD, Stage.DONE, Stage.FAILED)

    private fun Harness.settle(id: Long): Check = runBlocking {
        withTimeout(5_000) { pipeline.checks.first { list -> list.any { it.id == id && it.stage in terminal } } }
            .first { it.id == id }
    }

    @Test
    fun smallTalkStopsAtTier0WithoutAnyModelCall() {
        val models = FakeSource(gate(claimJson), gate(claimJson), listOf(verifier()))
        val h = harness(models)
        val check = h.settle(h.pipeline.submit("Sorry, I was on mute.")!!)
        assertEquals(Stage.FILTERED, check.stage)
        assertTrue(models.strict.prompts.isEmpty())
        assertTrue(h.pipeline.ledger.entries.value.isEmpty())
        assertEquals(PipelineCounts(processed = 1, filtered = 1), h.pipeline.counts.value)
        h.scope.cancel()
    }

    @Test
    fun strictClaimSendsOnlyTheCleanQuestion() {
        val models = FakeSource(gate(claimJson), gate(claimJson), listOf(verifier()))
        val h = harness(models)
        h.session.pin("city bus fares")
        h.session.setRegion(Region("Springfield", "", "US"))
        h.session.addUtterance("Remember the old fare?")
        val utterance = "They raised it again here last month."
        val check = h.settle(h.pipeline.submit(utterance)!!)

        assertEquals(Stage.DONE, check.stage)
        assertEquals(Verdict.VERIFIED, check.card!!.verdict)
        assertEquals("ON_DEVICE", check.gate!!.source)
        // The gatekeeper saw the context from before this sentence and the date hint.
        val gatePrompt = models.strict.prompts.last()
        assertTrue(gatePrompt.contains("Topic: city bus fares"))
        assertTrue(gatePrompt.contains("- Remember the old fare?"))
        assertFalse(gatePrompt.contains("- $utterance"))
        assertTrue(gatePrompt.contains("\"last month\" = October 2026"))
        // Only the verifier request left the phone, and it does not contain the sentence.
        val sent = h.pipeline.ledger.entries.value
        assertEquals(1, sent.size)
        assertEquals(EgressKind.CLEAN_QUERY, sent[0].kind)
        assertEquals("Check: Did Springfield raise bus fares in October 2026?", sent[0].text)
        assertFalse(sent[0].text.contains(utterance))
        assertEquals(0, sent.totals().rawBytes)
        assertEquals(listOf("v"), models.answered)
        assertEquals(utterance, h.session.state.value.recent.last())
        h.scope.cancel()
    }

    @Test
    fun strictWithoutTheModelSendsNothing() {
        val models = FakeSource(gate(claimJson), gate(claimJson), listOf(verifier()), ready = false)
        val h = harness(models)
        val check = h.settle(h.pipeline.submit("The Eiffel Tower is about 330 meters tall.")!!)
        assertEquals(Stage.NEEDS_MODEL, check.stage)
        assertTrue(models.strict.prompts.isEmpty())
        assertTrue(h.pipeline.ledger.entries.value.isEmpty())
        h.scope.cancel()
    }

    @Test
    fun balancedCloudFallbackIsRecordedAsRawText() {
        val models = FakeSource(gate(claimJson), gate(claimJson, source = "IN_CLOUD"), listOf(verifier()), ready = false)
        val h = harness(models)
        h.pipeline.setMode(PrivacyMode.BALANCED)
        val check = h.settle(h.pipeline.submit("The Eiffel Tower is about 330 meters tall.")!!)
        assertEquals(Stage.DONE, check.stage)
        val raw = h.pipeline.ledger.entries.value.filter { it.kind == EgressKind.RAW_TEXT }
        assertEquals(1, raw.size)
        assertTrue(raw[0].text.contains("Eiffel Tower"))
        assertTrue(h.pipeline.ledger.entries.value.totals().rawBytes > 0)
        h.scope.cancel()
    }

    @Test
    fun balancedOnDeviceReplyRecordsNoRawText() {
        val models = FakeSource(gate(claimJson), gate(claimJson, source = "ON_DEVICE"), listOf(verifier()))
        val h = harness(models)
        h.pipeline.setMode(PrivacyMode.BALANCED)
        h.settle(h.pipeline.submit("The Eiffel Tower is about 330 meters tall.")!!)
        assertTrue(h.pipeline.ledger.entries.value.none { it.kind == EgressKind.RAW_TEXT })
        h.scope.cancel()
    }

    @Test
    fun personalDataInTheQueryWithholdsIt() {
        val leaky = "{\"claim\": true, \"query\": \"Did the bus fare rise? Call Mark at 555-0134\"}"
        val models = FakeSource(gate(leaky), gate(leaky), listOf(verifier()))
        val h = harness(models)
        val check = h.settle(h.pipeline.submit("Call Mark at 555-0134 about the bus fare numbers.")!!)
        assertEquals(Stage.WITHHELD, check.stage)
        assertEquals(setOf(PiiKind.PHONE, PiiKind.NAME), check.withheld)
        assertTrue(models.verifiers[0].prompts.isEmpty())
        assertTrue(h.pipeline.ledger.entries.value.isEmpty())
        assertEquals(1, h.pipeline.counts.value.withheld)
        h.scope.cancel()
    }

    @Test
    fun noClaimAndInvalidRepliesSendNothing() {
        val models = FakeSource(gate("{\"claim\": false, \"query\": \"\", \"reason\": \"opinion\"}"), gate(claimJson), listOf(verifier()))
        val h = harness(models)
        val check = h.settle(h.pipeline.submit("Honestly that movie was overrated.")!!)
        assertEquals(Stage.NO_CLAIM, check.stage)
        assertEquals("opinion", check.gate!!.result.filterReason)

        val broken = FakeSource(gate("not json"), gate(claimJson), listOf(verifier()))
        val h2 = harness(broken)
        assertEquals(Stage.FAILED, h2.settle(h2.pipeline.submit("Python was first released in 1991.")!!).stage)
        assertTrue(h.pipeline.ledger.entries.value.isEmpty() && h2.pipeline.ledger.entries.value.isEmpty())
        h.scope.cancel()
        h2.scope.cancel()
    }

    @Test
    fun verifierFallsBackAndEveryAttemptIsInTheLedger() {
        val slow = FakeModel("slow") { delay(10_000); ModelReply("never", "IN_CLOUD") }
        val failing = FakeModel("failing") { throw IllegalStateException("quota") }
        val models = FakeSource(gate(claimJson), gate(claimJson), listOf(slow, failing, verifier("good")))
        val h = harness(models, verifyTimeoutMs = 100)
        val check = h.settle(h.pipeline.submit("Python was first released in 1991.")!!)
        assertEquals(Stage.DONE, check.stage)
        assertEquals("good", check.card!!.model)
        val outcomes = h.pipeline.ledger.entries.value.reversed().map { it.model to it.outcome }
        assertEquals(listOf("slow" to "timed out", "failing" to "IllegalStateException: quota", "good" to "ok"), outcomes)
        assertEquals(1, h.pipeline.ledger.entries.value.totals().cloudChecks)
        assertEquals(listOf("good"), models.answered)
        assertTrue(h.log.entries.value.any { it.model == "gatekeeper gate" })
        h.scope.cancel()
    }

    @Test
    fun clearForgetsChecksButKeepsTheLedger() {
        val models = FakeSource(gate(claimJson), gate(claimJson), listOf(verifier()))
        val h = harness(models)
        h.settle(h.pipeline.submit("Python was first released in 1991.")!!)
        h.pipeline.clear()
        assertTrue(h.pipeline.checks.value.isEmpty())
        assertEquals(PipelineCounts(), h.pipeline.counts.value)
        assertEquals(1, h.pipeline.ledger.entries.value.size)
        assertEquals(null, h.pipeline.submit("   "))
        h.scope.cancel()
    }
}

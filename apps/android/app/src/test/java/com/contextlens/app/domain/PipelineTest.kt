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

    private fun harness(
        models: ModelSource,
        verifyTimeoutMs: Long = 1_000,
        pauses: MutableList<Long> = mutableListOf(),
        pause: suspend (Long) -> Unit = { synchronized(pauses) { pauses += it } },
    ): Harness {
        val session = SessionContextManager { today }
        val log = CallLog()
        val scope = CoroutineScope(kotlinx.coroutines.Dispatchers.Default + Job())
        val p = HybridContextPipeline(
            scope, session, models, prompts, EgressLedger(), log,
            verifyTimeoutMs = verifyTimeoutMs, pause = pause,
        )
        return Harness(p, session, log, scope)
    }

    private val terminal = setOf(Stage.CLOUD_UNAVAILABLE, Stage.FILTERED, Stage.NO_CLAIM, Stage.NEEDS_MODEL, Stage.WITHHELD, Stage.DONE, Stage.FAILED)

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
        assertEquals(PipelineCounts(processed = 1, filtered = 1, readOnPhone = 1), h.pipeline.counts.value)
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
        // The cloud read it, so it does not count as read only on the phone.
        assertEquals(1, h.pipeline.counts.value.readInCloud)
        assertEquals(0, h.pipeline.counts.value.readOnPhone)
        assertEquals(1, h.pipeline.counts.value.checked)
        assertEquals(raw[0].bytes, h.pipeline.counts.value.rawBytes)
        assertTrue(check.sentToCloud)
        // Clearing the Ledger tab does not hide what this session sent.
        h.pipeline.ledger.clear()
        assertEquals(raw[0].bytes, h.pipeline.counts.value.rawBytes)
        h.scope.cancel()
    }

    @Test
    fun balancedOnDeviceReplyRecordsNoRawText() {
        val models = FakeSource(gate(claimJson), gate(claimJson, source = "ON_DEVICE"), listOf(verifier()))
        val h = harness(models)
        h.pipeline.setMode(PrivacyMode.BALANCED)
        h.settle(h.pipeline.submit("The Eiffel Tower is about 330 meters tall.")!!)
        assertTrue(h.pipeline.ledger.entries.value.none { it.kind == EgressKind.RAW_TEXT })
        assertEquals(1, h.pipeline.counts.value.readOnPhone)
        assertEquals(0, h.pipeline.counts.value.rawBytes)
        h.scope.cancel()
    }

    @Test
    fun balancedCloudReplyThatFailsStillSaysItWasSent() {
        val models = FakeSource(gate(claimJson), gate("not json", source = "IN_CLOUD"), listOf(verifier()), ready = false)
        val h = harness(models)
        h.pipeline.setMode(PrivacyMode.BALANCED)
        val check = h.settle(h.pipeline.submit("The Eiffel Tower is about 330 meters tall.")!!)
        assertEquals(Stage.FAILED, check.stage)
        assertEquals(null, check.gate)
        assertTrue(check.sentToCloud)
        assertEquals(PipelineCounts(processed = 1, readInCloud = 1, rawBytes = h.pipeline.ledger.entries.value.single().bytes), h.pipeline.counts.value)
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
        val failing = FakeModel("failing") { throw IllegalStateException("network unreachable") }
        val models = FakeSource(gate(claimJson), gate(claimJson), listOf(slow, failing, verifier("good")))
        val h = harness(models, verifyTimeoutMs = 100)
        val check = h.settle(h.pipeline.submit("Python was first released in 1991.")!!)
        assertEquals(Stage.DONE, check.stage)
        assertEquals("good", check.card!!.model)
        val outcomes = h.pipeline.ledger.entries.value.reversed().map { it.model to it.outcome }
        assertEquals(listOf("slow" to "timed out", "failing" to "IllegalStateException: network unreachable", "good" to "ok"), outcomes)
        assertEquals(1, h.pipeline.ledger.entries.value.totals().cloudChecks)
        assertEquals(1, h.pipeline.counts.value.checked)
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

    @Test
    fun clearDuringABalancedCloudCallStillRecordsIt() {
        val started = kotlinx.coroutines.CompletableDeferred<Unit>()
        val slowCloud = FakeModel("gate") { started.complete(Unit); delay(10_000); ModelReply(claimJson, "IN_CLOUD") }
        val models = FakeSource(gate(claimJson), slowCloud, listOf(verifier()), ready = false)
        val h = harness(models)
        h.pipeline.setMode(PrivacyMode.BALANCED)
        h.pipeline.submit("The Eiffel Tower is about 330 meters tall.")
        runBlocking { withTimeout(5_000) { started.await() } }
        h.pipeline.clear()
        val entries = runBlocking { withTimeout(5_000) { h.pipeline.ledger.entries.first { it.isNotEmpty() } } }
        assertEquals(EgressKind.RAW_TEXT, entries[0].kind)
        assertEquals(HybridContextPipeline.MAYBE_SENT, entries[0].outcome)
        // It belongs to the session that was cleared, not to the new one.
        assertEquals(0, h.pipeline.counts.value.readInCloud)
        assertEquals(0, h.pipeline.counts.value.rawBytes)
        h.scope.cancel()
    }

    @Test
    fun aFailureDeliveredAfterClearDoesNotCountInTheNewSession() {
        val started = kotlinx.coroutines.CompletableDeferred<Unit>()
        val release = kotlinx.coroutines.CompletableDeferred<Unit>()
        // Fails only after Clear, and ignores the cancellation meanwhile, like an error already on its way back.
        val lateFailure = FakeModel("gate") {
            kotlinx.coroutines.withContext(kotlinx.coroutines.NonCancellable) {
                started.complete(Unit)
                release.await()
            }
            throw java.io.IOException("connection reset")
        }
        val models = FakeSource(gate(claimJson), lateFailure, listOf(verifier()), ready = false)
        val h = harness(models)
        h.pipeline.setMode(PrivacyMode.BALANCED)
        h.pipeline.submit("The Eiffel Tower is about 330 meters tall.")
        runBlocking { withTimeout(5_000) { started.await() } }
        h.pipeline.clear()
        release.complete(Unit)
        val entries = runBlocking { withTimeout(5_000) { h.pipeline.ledger.entries.first { it.isNotEmpty() } } }
        // Still recorded as possibly sent, but it belongs to the session that was cleared.
        assertEquals(HybridContextPipeline.MAYBE_SENT, entries.single().outcome)
        assertEquals(PipelineCounts(), h.pipeline.counts.value)
        assertTrue(h.pipeline.checks.value.isEmpty())
        h.scope.cancel()
    }

    @Test
    fun switchingToStrictCoversSentencesAlreadyQueued() {
        val gateOpen = kotlinx.coroutines.CompletableDeferred<Unit>()
        val balanced = FakeModel("cloud-gate") { gateOpen.await(); ModelReply(claimJson, "IN_CLOUD") }
        val models = FakeSource(gate(claimJson), balanced, listOf(verifier()))
        val h = harness(models)
        h.pipeline.setMode(PrivacyMode.BALANCED)
        val first = h.pipeline.submit("The Eiffel Tower is about 330 meters tall.")!!
        val second = h.pipeline.submit("Python was first released in 1991.")!!
        runBlocking { withTimeout(5_000) { while (balanced.prompts.isEmpty()) delay(10) } }
        h.pipeline.setMode(PrivacyMode.STRICT)
        gateOpen.complete(Unit)
        h.settle(first)
        assertEquals(Stage.DONE, h.settle(second).stage)
        assertEquals(1, balanced.prompts.size)
        assertEquals(1, models.strict.prompts.size)
        h.scope.cancel()
    }

    @Test
    fun strictReplyFromTheCloudIsRecordedAndNotUsed() {
        val models = FakeSource(gate(claimJson, source = "IN_CLOUD"), gate(claimJson), listOf(verifier()))
        val h = harness(models)
        val check = h.settle(h.pipeline.submit("The Eiffel Tower is about 330 meters tall.")!!)
        assertEquals(Stage.FAILED, check.stage)
        val sent = h.pipeline.ledger.entries.value
        assertEquals(listOf(EgressKind.RAW_TEXT), sent.map { it.kind })
        assertTrue(models.verifiers[0].prompts.isEmpty())
        h.scope.cancel()
    }

    @Test
    fun quotaRefusalStopsAndOffersASearch() {
        val refused = FakeModel("lite") { throw IllegalStateException("QuotaExceededException: You exceeded your current quota") }
        val second = verifier("flash")
        val models = FakeSource(gate(claimJson), gate(claimJson), listOf(refused, second))
        val h = harness(models)
        val check = h.settle(h.pipeline.submit("Python was first released in 1991.")!!)
        assertEquals(Stage.CLOUD_UNAVAILABLE, check.stage)
        assertTrue(second.prompts.isEmpty())
        assertEquals(1, h.pipeline.ledger.entries.value.size)
        assertEquals(
            "https://www.google.com/search?q=Did+Springfield+raise+bus+fares+in+October+2026%3F",
            searchUrl(check.gate!!.result.sanitizedResolvedQuery),
        )
        assertTrue(isCloudLimit("HTTP 402 Payment Required") && isCloudLimit("RESOURCE_EXHAUSTED") && !isCloudLimit("timed out"))
        h.scope.cancel()
    }

    private val quotaRefusal = "[ErrorCode 9] Request cannot be processed. Either your app is out of usage quota"

    /** Refuses for quota [refusals] times, then answers with [json]. */
    private fun busyGate(refusals: Int, json: String = claimJson): FakeModel {
        var calls = 0
        return FakeModel("gate") {
            if (calls++ < refusals) throw IllegalStateException(quotaRefusal)
            ModelReply(json, "ON_DEVICE")
        }
    }

    @Test
    fun strictRetriesTheModelAfterAQuotaRefusal() {
        val strict = busyGate(1)
        val models = FakeSource(strict, gate(claimJson), listOf(verifier()))
        val pauses = mutableListOf<Long>()
        val h = harness(models, pauses = pauses)
        val check = h.settle(h.pipeline.submit("They raised bus fares here last month.")!!)
        assertEquals(Stage.DONE, check.stage)
        assertEquals(2, strict.prompts.size)
        assertEquals(listOf(5_000L), pauses)
        assertEquals(null, check.note)
        assertTrue(h.pipeline.ledger.entries.value.none { it.kind == EgressKind.RAW_TEXT })
        assertEquals(1, h.pipeline.counts.value.readOnPhone)
        // both gatekeeper attempts are in the call log; the refusal says it will try again
        val gates = h.log.entries.value.filter { it.model.startsWith("gatekeeper") }
        assertEquals(2, gates.size)
        assertEquals(1, gates.count { it.outcome.contains("usage quota") && it.outcome.endsWith("trying again in 5 s") })
        h.scope.cancel()
    }

    @Test
    fun strictGivesUpAfterTheLastQuotaRefusal() {
        val strict = busyGate(3)
        val models = FakeSource(strict, gate(claimJson), listOf(verifier()))
        val pauses = mutableListOf<Long>()
        val h = harness(models, pauses = pauses)
        val check = h.settle(h.pipeline.submit("They raised bus fares here last month.")!!)
        assertEquals(Stage.FAILED, check.stage)
        assertEquals(3, strict.prompts.size)
        assertEquals(listOf(5_000L, 15_000L), pauses)
        assertTrue(check.note.orEmpty().contains("usage quota"))
        h.scope.cancel()
    }

    @Test
    fun otherFailuresAndBalancedAreNotRetried() {
        val broken = FakeModel("gate") { throw IllegalStateException("model not found") }
        val pauses = mutableListOf<Long>()
        val h = harness(FakeSource(broken, gate(claimJson), listOf(verifier())), pauses = pauses)
        assertEquals(Stage.FAILED, h.settle(h.pipeline.submit("They raised bus fares here last month.")!!).stage)
        assertEquals(1, broken.prompts.size)
        h.scope.cancel()

        val balanced = busyGate(1)
        val b = harness(FakeSource(gate(claimJson), balanced, listOf(verifier())), pauses = pauses)
        b.pipeline.setMode(PrivacyMode.BALANCED)
        assertEquals(Stage.FAILED, b.settle(b.pipeline.submit("They raised bus fares here last month.")!!).stage)
        assertEquals(1, balanced.prompts.size)
        assertTrue(pauses.isEmpty())
        b.scope.cancel()
    }

    @Test
    fun theCardShowsTheWaitAndClearStopsIt() {
        val strict = busyGate(1)
        val entered = kotlinx.coroutines.CompletableDeferred<Unit>()
        val waiting = kotlinx.coroutines.CompletableDeferred<Unit>()
        // A wait that ignores cancellation: only the pipeline's own check after it can stop the retry.
        val h = harness(FakeSource(strict, gate(claimJson), listOf(verifier())), pause = {
            entered.complete(Unit)
            kotlinx.coroutines.withContext(kotlinx.coroutines.NonCancellable) { waiting.await() }
        })
        val id = h.pipeline.submit("They raised bus fares here last month.")!!
        val card = runBlocking {
            withTimeout(5_000) { h.pipeline.checks.first { list -> list.any { it.id == id && it.note != null } } }.first { it.id == id }
        }
        assertEquals(Stage.GATEKEEPING, card.stage)
        assertEquals("The phone's model is busy; trying again in 5 s.", card.note)
        runBlocking { withTimeout(5_000) { entered.await() } }
        h.pipeline.clear()
        // the wait ends after Clear; asking the model again now would be a second prompt
        waiting.complete(Unit)
        runBlocking { delay(200) }
        assertEquals(1, strict.prompts.size)
        assertEquals(1, h.log.entries.value.count { it.model.startsWith("gatekeeper") })
        assertTrue(h.pipeline.checks.value.isEmpty())
        assertTrue(h.pipeline.ledger.entries.value.isEmpty())
        assertEquals(PipelineCounts(), h.pipeline.counts.value)
        h.scope.cancel()
    }
}

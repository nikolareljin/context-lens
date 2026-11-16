package com.contextlens.app.domain

import com.contextlens.app.context.SessionContextManager
import java.time.LocalDate
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
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

class DemoTest {
    private val prompts = PipelinePrompts(Prompt("v1", "{{context}} {{hints}} {{utterance}}"), Prompt("v1", "{{query}}"))

    private object NoClaim : ModelSource {
        private val model = object : TextModel {
            override val name = "gate"
            override suspend fun generate(prompt: String) = ModelReply("{\"claim\": false}", "ON_DEVICE")
        }
        override fun gatekeeper(mode: PrivacyMode): TextModel = model
        override fun verifiers(): List<TextModel> = emptyList()
        override fun onDeviceReady() = true
    }

    private class Rig(gapMs: Long) {
        val scope = CoroutineScope(Dispatchers.Default + Job())
        val session = SessionContextManager { LocalDate.of(2026, 11, 15) }
        val pipeline = HybridContextPipeline(scope, session, NoClaim, DemoTest().prompts, EgressLedger())
        val demo = DemoRunner(scope, pipeline, session, gapMs)
    }

    @Test
    fun smallTalkInTheScriptStopsAtTheLocalRules() {
        val (talk, rest) = DemoScript.lines.partition { Tier0Filter.check(it) is Tier0Filter.Decision.Drop }
        assertEquals(4, talk.size)
        assertEquals(DemoScript.lines.take(4), talk)
        assertEquals(2, rest.size)
    }

    @Test
    fun theDemoStartsCleanAndMarksEveryCard() = runBlocking {
        val rig = Rig(gapMs = 0)
        rig.pipeline.submit("Something said before the demo started here.")
        rig.session.pin("another topic")

        rig.demo.start()
        withTimeout(5_000) { rig.demo.running.first { !it } }
        val checks = withTimeout(5_000) { rig.pipeline.checks.first { it.size == DemoScript.lines.size } }

        assertEquals(DemoScript.lines, checks.reversed().map { it.utterance })
        assertTrue(checks.all { it.demo })
        assertEquals(DemoScript.TOPIC, rig.session.state.value.pinnedTopic)
        assertEquals(DemoScript.region, rig.session.state.value.region)
        assertEquals(4, checks.count { it.stage == Stage.FILTERED })
        assertTrue(rig.pipeline.ledger.entries.value.isEmpty())
        rig.scope.cancel()
    }

    @Test
    fun stopHaltsTheScriptAndARestartKeepsRunning() = runBlocking {
        val rig = Rig(gapMs = 10_000)
        rig.demo.start()
        withTimeout(5_000) { rig.pipeline.checks.first { it.size == 1 } }
        rig.demo.stop()
        assertFalse(rig.demo.running.value)
        delay(100)
        assertEquals(1, rig.pipeline.checks.value.size)

        // The stopped run finishing late must not mark the new one as done.
        rig.demo.start()
        delay(100)
        assertTrue(rig.demo.running.value)
        rig.demo.stop()
        rig.scope.cancel()
    }

    @Test
    fun typedSentencesAreNotDemoInput() {
        val rig = Rig(gapMs = 0)
        rig.pipeline.submit("Sorry, I was on mute.")
        assertFalse(rig.pipeline.checks.value.single().demo)
        rig.scope.cancel()
    }
}

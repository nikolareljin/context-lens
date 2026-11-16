package com.contextlens.app.domain

import com.contextlens.app.context.Region
import com.contextlens.app.context.SessionContextManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * A fixed conversation for recordings and for trying the app without speaking.
 * Every line goes through the real pipeline and its card is marked as demo input.
 * The place is fictional, so no real town shows up on screen.
 */
object DemoScript {
    val region = Region("Springfield", "", "")
    const val TOPIC = "city bus fares"

    val lines = listOf(
        // Small talk: the local rules drop these, so no model runs and nothing is sent.
        "Morning! Did you sleep okay?",
        "Can you pass the water?",
        "Thanks, that was great.",
        "Sorry, I was on mute.",
        // A claim that needs the place, the date and the topic to make sense.
        "They raised it again here last month.",
        // A sentence with a name and a phone number in it.
        "Call Mark at 555-0134 about the bus fare numbers.",
    )

    /** Long enough to read each card as it appears. */
    const val LINE_GAP_MS = 2_500L
}

/** Plays [DemoScript] into the pipeline, one line at a time. */
class DemoRunner(
    private val scope: CoroutineScope,
    private val pipeline: HybridContextPipeline,
    private val session: SessionContextManager,
    private val gapMs: Long = DemoScript.LINE_GAP_MS,
) {
    private val _running = MutableStateFlow(false)
    val running: StateFlow<Boolean> = _running.asStateFlow()

    // start, stop and the end of a run take this lock, so a run that ends late can't clear a newer run's flag.
    private val lock = Any()
    private var job: Job? = null

    /** Starts from a clean session: earlier sentences, place and topic are cleared first. */
    fun start() = synchronized(lock) {
        stop()
        pipeline.clear()
        session.clear()
        session.setRegion(DemoScript.region)
        session.pin(DemoScript.TOPIC)
        _running.value = true
        // Assigned before it starts, so the check in finally sees it even on an immediate dispatcher.
        val run = scope.launch(start = CoroutineStart.LAZY) {
            val self = coroutineContext[Job]
            try {
                DemoScript.lines.forEachIndexed { i, line ->
                    if (i > 0) delay(gapMs)
                    // A stopped run must not add a line to the next session.
                    synchronized(lock) { if (job === self) pipeline.submit(line, demo = true) }
                }
            } finally {
                // A stopped run must not mark a newer one as finished.
                synchronized(lock) { if (job === self) _running.value = false }
            }
        }
        job = run
        run.start()
    }

    /** Stops feeding lines; sentences already submitted finish normally. */
    fun stop() = synchronized(lock) {
        job?.cancel()
        job = null
        _running.value = false
    }
}

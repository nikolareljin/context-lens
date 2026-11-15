package com.contextlens.app.speech

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow

/** What to do after a recognizer error. */
sealed interface Restart {
    data class After(val delayMs: Long) : Restart
    data class Stop(val reason: String) : Restart
}

/**
 * The listening loop's error policy. Silence and "no match" are normal in a
 * continuous session and restart at once; transient errors back off; errors the
 * user has to fix stop the loop.
 */
object RestartPolicy {
    const val MAX_FAILURES = 5
    const val BENIGN_DELAY_MS = 100L

    /** Errors after which the recognizer instance is rebuilt rather than reused. */
    fun needsNewRecognizer(error: Int): Boolean =
        error != SpeechRecognizer.ERROR_NO_MATCH && error != SpeechRecognizer.ERROR_SPEECH_TIMEOUT

    fun after(error: Int, consecutiveFailures: Int): Restart = when (error) {
        // A short pause, so a recognizer that returns "no match" at once cannot spin.
        SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> Restart.After(BENIGN_DELAY_MS)
        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> Restart.Stop("microphone permission missing")
        SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED, SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE ->
            Restart.Stop("on-device speech for this language is not installed")
        else ->
            if (consecutiveFailures >= MAX_FAILURES) Restart.Stop("speech recognizer keeps failing (error $error)")
            else Restart.After(250L * (1L shl consecutiveFailures.coerceAtMost(4)))
    }
}

sealed interface ListenState {
    data object Idle : ListenState
    data object Listening : ListenState
    data class Stopped(val reason: String) : ListenState
}

/**
 * Continuous speech-to-text that runs on the phone only. The on-device recognizer
 * (Android 12+) is required: without it the microphone stays off, because the
 * regular recognizer may send audio to a server. Finished utterances arrive on
 * [utterances]; [partial] shows the words being heard.
 */
class SpeechListener(private val context: Context) {
    private val main = Handler(Looper.getMainLooper())
    private var recognizer: SpeechRecognizer? = null
    private var active = false
    private var failures = 0

    private val _state = MutableStateFlow<ListenState>(ListenState.Idle)
    val state: StateFlow<ListenState> = _state.asStateFlow()
    private val _partial = MutableStateFlow("")
    val partial: StateFlow<String> = _partial.asStateFlow()
    private val _utterances = MutableSharedFlow<String>(extraBufferCapacity = 16)
    val utterances: SharedFlow<String> = _utterances.asSharedFlow()

    fun start() {
        if (active) return
        if (!isOnDeviceAvailable(context)) {
            _state.value = ListenState.Stopped("on-device speech recognition is not available on this phone")
            return
        }
        active = true
        failures = 0
        _state.value = ListenState.Listening
        listenOnce()
    }

    fun stop() {
        active = false
        main.removeCallbacksAndMessages(null)
        recognizer?.destroy()
        recognizer = null
        _partial.value = ""
        if (_state.value == ListenState.Listening) _state.value = ListenState.Idle
    }

    private fun listenOnce() {
        // start() only gets here on Android 12+, where the on-device recognizer exists.
        if (!active || Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
        val r = recognizer ?: SpeechRecognizer.createOnDeviceSpeechRecognizer(context).also {
            it.setRecognitionListener(listener)
            recognizer = it
        }
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            .putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
        r.startListening(intent)
    }

    private fun restartAfter(delayMs: Long) {
        if (active) main.postDelayed({ listenOnce() }, delayMs)
    }

    private val listener = object : RecognitionListener {
        override fun onPartialResults(partialResults: Bundle?) {
            _partial.value = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
        }

        override fun onResults(results: Bundle?) {
            failures = 0
            val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
            _partial.value = ""
            if (text.isNotBlank()) _utterances.tryEmit(text)
            restartAfter(0)
        }

        override fun onError(error: Int) {
            // An error that arrives after stop() must not change the state.
            if (!active) return
            _partial.value = ""
            if (RestartPolicy.needsNewRecognizer(error)) {
                recognizer?.destroy()
                recognizer = null
            }
            when (val next = RestartPolicy.after(error, failures)) {
                is Restart.After -> {
                    if (RestartPolicy.needsNewRecognizer(error)) failures++
                    restartAfter(next.delayMs)
                }
                is Restart.Stop -> {
                    stop()
                    _state.value = ListenState.Stopped(next.reason)
                }
            }
        }

        override fun onReadyForSpeech(params: Bundle?) = Unit
        override fun onBeginningOfSpeech() = Unit
        override fun onRmsChanged(rmsdB: Float) = Unit
        override fun onBufferReceived(buffer: ByteArray?) = Unit
        override fun onEndOfSpeech() = Unit
        override fun onEvent(eventType: Int, params: Bundle?) = Unit
    }

    companion object {
        fun isOnDeviceAvailable(context: Context): Boolean =
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && SpeechRecognizer.isOnDeviceRecognitionAvailable(context)
    }
}

package com.contextlens.app.speech

import android.speech.SpeechRecognizer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class RestartPolicyTest {
    @Test
    fun silenceRestartsAtOnce() {
        assertEquals(Restart.After(100), RestartPolicy.after(SpeechRecognizer.ERROR_NO_MATCH, 0))
        assertEquals(Restart.After(100), RestartPolicy.after(SpeechRecognizer.ERROR_SPEECH_TIMEOUT, 4))
    }

    @Test
    fun transientErrorsBackOff() {
        assertEquals(Restart.After(250), RestartPolicy.after(SpeechRecognizer.ERROR_RECOGNIZER_BUSY, 0))
        assertEquals(Restart.After(500), RestartPolicy.after(SpeechRecognizer.ERROR_CLIENT, 1))
        assertEquals(Restart.After(4000), RestartPolicy.after(SpeechRecognizer.ERROR_AUDIO, 4))
    }

    @Test
    fun repeatedFailuresStop() {
        assertTrue(RestartPolicy.after(SpeechRecognizer.ERROR_AUDIO, RestartPolicy.MAX_FAILURES) is Restart.Stop)
    }

    @Test
    fun onlySilenceKeepsTheRecognizer() {
        assertTrue(!RestartPolicy.needsNewRecognizer(SpeechRecognizer.ERROR_NO_MATCH))
        assertTrue(RestartPolicy.needsNewRecognizer(SpeechRecognizer.ERROR_SERVER_DISCONNECTED))
        assertTrue(RestartPolicy.needsNewRecognizer(SpeechRecognizer.ERROR_CLIENT))
    }

    @Test
    fun errorsTheUserMustFixStop() {
        assertTrue(RestartPolicy.after(SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS, 0) is Restart.Stop)
        assertTrue(RestartPolicy.after(SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE, 0) is Restart.Stop)
    }
}

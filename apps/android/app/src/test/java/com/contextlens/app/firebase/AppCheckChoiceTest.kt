package com.contextlens.app.firebase

import org.junit.Assert.assertEquals
import org.junit.Test

class AppCheckChoiceTest {
    @Test
    fun debugBuildsUseTheDebugProvider() {
        assertEquals(AppCheckChoice.DEBUG, AppCheckChoice.forBuild(debuggable = true))
    }

    @Test
    fun releaseBuildsUsePlayIntegrity() {
        assertEquals(AppCheckChoice.PLAY_INTEGRITY, AppCheckChoice.forBuild(debuggable = false))
    }

    @Test
    fun theUnitTestVariantIsDebugAndInstallsTheDebugProvider() {
        // testDebugUnitTest compiles the debug source set's AppCheckProviders.
        assertEquals(AppCheckChoice.DEBUG, AppCheckProviders.choice)
    }
}

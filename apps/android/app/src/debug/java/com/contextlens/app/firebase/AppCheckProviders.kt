package com.contextlens.app.firebase

import com.google.firebase.appcheck.AppCheckProviderFactory
import com.google.firebase.appcheck.debug.DebugAppCheckProviderFactory

/** Debug builds: the App Check debug provider. Its token appears in logcat on first run. */
object AppCheckProviders {
    val choice: AppCheckChoice = AppCheckChoice.forBuild(debuggable = true)

    fun factory(): AppCheckProviderFactory = DebugAppCheckProviderFactory.getInstance()
}

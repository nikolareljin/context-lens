package com.contextlens.app.firebase

import com.google.firebase.appcheck.AppCheckProviderFactory
import com.google.firebase.appcheck.playintegrity.PlayIntegrityAppCheckProviderFactory

/** Release builds: Play Integrity. */
object AppCheckProviders {
    val choice: AppCheckChoice = AppCheckChoice.forBuild(debuggable = false)

    fun factory(): AppCheckProviderFactory = PlayIntegrityAppCheckProviderFactory.getInstance()
}

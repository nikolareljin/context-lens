package com.contextlens.app

import android.app.Application
import android.util.Log
import com.contextlens.app.ai.ModelGateway
import com.contextlens.app.firebase.AppCheckProviders
import com.contextlens.app.firebase.FirebaseSession
import com.google.firebase.Firebase
import com.google.firebase.appcheck.appCheck
import com.google.firebase.crashlytics.crashlytics
import com.google.firebase.initialize
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class ContextLensApp : Application() {
    /** Process-wide objects; small enough that a container class is all the wiring needed. */
    val session = FirebaseSession()
    // Last line of defense: an unexpected error in a background task is logged, not a crash.
    private val appScope = CoroutineScope(
        SupervisorJob() + Dispatchers.Main.immediate +
            CoroutineExceptionHandler { _, e -> Log.e("ContextLens", "background task failed", e) },
    )
    /** Created on first use, after Firebase and App Check are initialized in onCreate. */
    val models: ModelGateway by lazy { ModelGateway(appScope) }

    override fun onCreate() {
        super.onCreate()
        Firebase.initialize(this)
        // App Check before any Firebase AI Logic call, so every cloud request carries a token.
        Firebase.appCheck.installAppCheckProviderFactory(AppCheckProviders.factory())
        // Crash reports from release builds only.
        Firebase.crashlytics.isCrashlyticsCollectionEnabled = !BuildConfig.DEBUG
        appScope.launch { session.ensureSignedIn() }
    }
}

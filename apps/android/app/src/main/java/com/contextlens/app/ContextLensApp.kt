package com.contextlens.app

import android.app.Application
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.util.Log
import androidx.core.content.edit
import com.contextlens.app.ai.FirebaseModelSource
import com.contextlens.app.ai.ModelGateway
import com.contextlens.app.ai.loadPrompts
import com.contextlens.app.context.SessionContextManager
import com.contextlens.app.domain.DemoRunner
import com.contextlens.app.domain.EgressLedger
import com.contextlens.app.domain.HybridContextPipeline
import com.contextlens.app.firebase.AppCheckProviders
import com.contextlens.app.firebase.CloudProjectStore
import com.contextlens.app.firebase.CloudSetup
import com.contextlens.app.firebase.CloudSource
import com.contextlens.app.firebase.CloudState
import com.contextlens.app.firebase.FirebaseSession
import com.google.firebase.Firebase
import com.google.firebase.appcheck.appCheck
import com.google.firebase.crashlytics.crashlytics
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class ContextLensApp : Application() {
    /** Process-wide objects; small enough that a container class is all the wiring needed. */
    val session = FirebaseSession()
    /** The user's Firebase project, if they connected one in Settings. */
    val cloudStore: CloudProjectStore by lazy { CloudProjectStore(this) }
    /** The project Firebase was initialized with in onCreate; changes apply after a restart. */
    lateinit var cloud: CloudState
        private set
    /** The listening session's context: in memory only, gone with the process. */
    val sessionContext = SessionContextManager()
    // Last line of defense: an unexpected error in a background task is logged, not a crash.
    private val appScope = CoroutineScope(
        SupervisorJob() + Dispatchers.Main.immediate +
            CoroutineExceptionHandler { _, e -> Log.e("ContextLens", "background task failed", e) },
    )
    /** Created on first use, after Firebase and App Check are initialized in onCreate. */
    val models: ModelGateway by lazy { ModelGateway(appScope, cloudReady = { cloud.ready }) }

    /** Every request that leaves the phone; in memory only. */
    val ledger = EgressLedger()

    val pipeline: HybridContextPipeline by lazy {
        HybridContextPipeline(
            scope = appScope,
            session = sessionContext,
            models = FirebaseModelSource(models),
            prompts = loadPrompts(assets),
            ledger = ledger,
            callLog = models.log,
            online = ::hasNetwork,
            cloudProject = { cloud.ready },
        )
    }

    /** True when the phone has a network that can reach the internet (airplane mode: false). */
    private fun hasNetwork(): Boolean {
        val cm = getSystemService(ConnectivityManager::class.java) ?: return true
        val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    /** App-wide, so the demo keeps running while the Ledger is open. */
    val demo: DemoRunner by lazy { DemoRunner(appScope, pipeline, sessionContext) }

    override fun onCreate() {
        super.onCreate()
        // Crashlytics keeps the last value set in code and prefers it to the manifest's "off".
        // Cleared before Firebase starts, so an upgrade from a build that turned it on sends
        // nothing at startup; it is turned on again below only where it belongs.
        getSharedPreferences("com.google.firebase.crashlytics", MODE_PRIVATE).edit(commit = true) {
            remove("firebase_crashlytics_collection_enabled")
        }
        cloud = CloudSetup.initialize(this, cloudStore)
        // App Check before any Firebase AI Logic call, so every cloud request carries a token.
        Firebase.appCheck.installAppCheckProviderFactory(AppCheckProviders.factory())
        // Crash reports from release builds with the built-in project only; never to a user's project.
        Firebase.crashlytics.isCrashlyticsCollectionEnabled = !BuildConfig.DEBUG && cloud.source == CloudSource.BUILT_IN
        if (cloud.ready) appScope.launch { session.ensureSignedIn() } else session.notConnected()
    }
}

package com.contextlens.app.firebase

import android.content.Context
import android.content.Intent
import androidx.core.content.edit
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions

/** The project the app started with; a change applies after a restart. */
data class CloudState(val source: CloudSource, val projectId: String?) {
    val ready: Boolean get() = source != CloudSource.NONE
}

/** The user's project, in the app's private storage; excluded from backup and device transfer (data_extraction_rules.xml). */
class CloudProjectStore(context: Context) {
    private val prefs = context.getSharedPreferences("cloud_project", Context.MODE_PRIVATE)

    fun load(): CloudProject? {
        val project = CloudProject(
            projectId = prefs.getString(PROJECT_FIELD, null) ?: return null,
            appId = prefs.getString(APP_FIELD, null) ?: return null,
            apiKey = prefs.getString(API_FIELD, null) ?: return null,
        )
        return project.takeIf { CloudProjects.problems(it).isEmpty() }
    }

    /** Writes synchronously (commit), so a restart right after keeps the values. */
    fun save(project: CloudProject) = prefs.edit(commit = true) {
        putString(PROJECT_FIELD, project.projectId)
        putString(APP_FIELD, project.appId)
        putString(API_FIELD, project.apiKey)
    }

    fun clear() = prefs.edit(commit = true) { clear() }

    private companion object {
        const val PROJECT_FIELD = "project_id"
        const val APP_FIELD = "app_id"
        const val API_FIELD = "api"
    }
}

object CloudSetup {
    /**
     * Initializes the default Firebase app before anything uses it (the automatic
     * initializer is removed in the manifest). The user's project wins; otherwise the
     * built-in configuration, which in public builds is the placeholder. The placeholder
     * still initializes Firebase, so on-device inference works, but the cloud step is off.
     */
    fun initialize(context: Context, store: CloudProjectStore): CloudState {
        val own = store.load()
        if (own != null) {
            FirebaseApp.initializeApp(context, options(own))
            return CloudState(CloudSource.CONNECTED, own.projectId)
        }
        // Every build has the resource (the google-services plugin requires the file); the
        // fallback keeps App Check and Crashlytics, which need a default app, from crashing.
        val builtIn = FirebaseOptions.fromResource(context) ?: placeholderOptions()
        FirebaseApp.initializeApp(context, builtIn)
        return if (CloudProjects.isPlaceholder(builtIn.projectId)) {
            CloudState(CloudSource.NONE, null)
        } else {
            CloudState(CloudSource.BUILT_IN, builtIn.projectId)
        }
    }

    /** The values of scripts/ci/google-services.placeholder.json: no project can be reached with them. */
    private fun placeholderOptions(): FirebaseOptions = FirebaseOptions.Builder()
        .setProjectId(CloudProjects.PLACEHOLDER_PROJECT_ID)
        .setApplicationId("1:000000000000:android:0000000000000000")
        .setApiKey("placeholder-not-a-key")
        .build()

    private fun options(project: CloudProject): FirebaseOptions = FirebaseOptions.Builder()
        .setProjectId(project.projectId)
        .setApplicationId(project.appId)
        .setApiKey(project.apiKey)
        // The sender id is the project number, the second part of the app id.
        .setGcmSenderId(project.appId.split(':')[1])
        .build()

    /**
     * Starts the app again, so Firebase initializes with the new project. Returns false
     * when the app can't find its own launcher entry; the user then reopens it.
     */
    fun restart(context: Context): Boolean {
        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return false
        context.startActivity(Intent.makeRestartActivityTask(launch.component))
        Runtime.getRuntime().exit(0)
        return true
    }
}

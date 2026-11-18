package com.contextlens.app.firebase

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.net.URLDecoder

/**
 * The Firebase project the cloud step runs on: the user's own, entered in Settings.
 * Public builds carry only a placeholder, so without one the app works on the phone alone.
 * These are the values from the project's google-services.json; none of them is a secret,
 * but they decide whose quota and bill the cloud step uses.
 */
data class CloudProject(
    val projectId: String,
    val appId: String,
    val apiKey: String,
)

/** Where the app's Firebase configuration comes from. */
enum class CloudSource {
    /** Entered by the user in Settings. */
    CONNECTED,
    /** A real google-services.json was built into this APK (a maintainer's own build). */
    BUILT_IN,
    /** Only the placeholder: the cloud step is off and nothing is sent. */
    NONE,
}

enum class CloudProjectProblem { PROJECT_ID, APP_ID, API_KEY }

object CloudProjects {
    /** The project id in scripts/ci/google-services.placeholder.json, which public builds carry. */
    const val PLACEHOLDER_PROJECT_ID = "placeholder-project"

    private val projectIdPattern = Regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$")
    private val appIdPattern = Regex("^1:\\d+:android:[0-9a-f]+$")
    private val apiKeyPattern = Regex("^AIza[0-9A-Za-z_-]{35}$")

    fun isPlaceholder(projectId: String?): Boolean = projectId.isNullOrBlank() || projectId == PLACEHOLDER_PROJECT_ID

    /** Fields that don't look like a Firebase Android app's values; empty when all do. */
    fun problems(project: CloudProject): Set<CloudProjectProblem> = buildSet {
        if (!projectIdPattern.matches(project.projectId) || isPlaceholder(project.projectId)) add(CloudProjectProblem.PROJECT_ID)
        if (!appIdPattern.matches(project.appId)) add(CloudProjectProblem.APP_ID)
        if (!apiKeyPattern.matches(project.apiKey)) add(CloudProjectProblem.API_KEY)
    }

    /** The start of a connect code: `contextlens-connect:1?project=…&app=…&key=…`. */
    const val CONNECT_PREFIX = "contextlens-connect:1?"

    /**
     * The project in a connect code, scanned or pasted inside the app (scripts/connect-qr.sh
     * makes one). Null when it is not a connect code or a value is missing or malformed.
     */
    fun fromConnectCode(text: String): CloudProject? {
        val code = text.trim()
        if (!code.startsWith(CONNECT_PREFIX)) return null
        val params = code.removePrefix(CONNECT_PREFIX).split('&').mapNotNull { part ->
            val i = part.indexOf('=')
            if (i <= 0) {
                null
            } else {
                runCatching { part.substring(0, i) to URLDecoder.decode(part.substring(i + 1), "UTF-8") }.getOrNull()
            }
        }.toMap()
        val project = clean(
            CloudProject(
                projectId = params["project"] ?: return null,
                appId = params["app"] ?: return null,
                apiKey = params["key"] ?: return null,
            ),
        )
        return project.takeIf { problems(it).isEmpty() }
    }

    /** Trims what a copy and paste tends to add around each value. */
    fun clean(project: CloudProject): CloudProject = CloudProject(
        projectId = project.projectId.trim().trim('"'),
        appId = project.appId.trim().trim('"'),
        apiKey = project.apiKey.trim().trim('"'),
    )

    /**
     * The values for [packageName] from a google-services.json, or null when the text is
     * not one or has no Android app with that package.
     */
    fun fromGoogleServicesJson(text: String, packageName: String): CloudProject? {
        val root = runCatching { Json.parseToJsonElement(text).jsonObject }.getOrNull() ?: return null
        val projectId = root["project_info"]?.objectOrNull()?.string("project_id") ?: return null
        val clients = root["client"] as? JsonArray ?: return null
        val client = clients.mapNotNull { it.objectOrNull() }.firstOrNull { c ->
            c["client_info"]?.objectOrNull()?.get("android_client_info")?.objectOrNull()?.string("package_name") == packageName
        } ?: return null
        val appId = client["client_info"]?.objectOrNull()?.string("mobilesdk_app_id") ?: return null
        val apiKey = (client["api_key"] as? JsonArray)?.firstNotNullOfOrNull { it.objectOrNull()?.string("current_key") } ?: return null
        return CloudProject(projectId, appId, apiKey)
    }

    private fun JsonElement.objectOrNull(): JsonObject? = this as? JsonObject

    private fun JsonObject.string(key: String): String? =
        runCatching { this[key]?.jsonPrimitive?.contentOrNull }.getOrNull()?.takeIf { it.isNotBlank() }
}

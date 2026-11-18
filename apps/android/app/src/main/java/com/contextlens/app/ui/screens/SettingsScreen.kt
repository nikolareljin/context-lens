package com.contextlens.app.ui.screens

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.contextlens.app.R
import com.contextlens.app.firebase.CloudProject
import com.contextlens.app.firebase.CloudProjectProblem
import com.contextlens.app.firebase.CloudProjectStore
import com.contextlens.app.firebase.CloudProjects
import com.contextlens.app.firebase.CloudSetup
import com.contextlens.app.firebase.CloudSource
import com.contextlens.app.firebase.CloudState

/** Step-by-step guide for creating a project for the cloud check. */
private const val OWN_PROJECT_GUIDE = "https://nikolareljin.github.io/context-lens/docs/own-project/"

/** Largest file read as a google-services.json; real ones are about 1 KB. */
private const val MAX_CONFIG_BYTES = 64 * 1024

@Composable
fun SettingsScreen(cloud: CloudState, store: CloudProjectStore) {
    val context = LocalContext.current
    val uri = LocalUriHandler.current
    val saved = remember { store.load() }
    var projectId by remember { mutableStateOf(saved?.projectId.orEmpty()) }
    var appId by remember { mutableStateOf(saved?.appId.orEmpty()) }
    var apiKey by remember { mutableStateOf(saved?.apiKey.orEmpty()) }
    var problems by remember { mutableStateOf(emptySet<CloudProjectProblem>()) }
    var message by remember { mutableStateOf<String?>(null) }
    val importFailed = stringResource(R.string.settings_import_failed)
    val importDone = stringResource(R.string.settings_import_done)

    val importFile = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { picked ->
        if (picked == null) return@rememberLauncherForActivityResult
        val text = runCatching {
            context.contentResolver.openInputStream(picked)?.use { input ->
                val bytes = input.readNBytesCompat(MAX_CONFIG_BYTES + 1)
                if (bytes.size > MAX_CONFIG_BYTES) null else bytes.decodeToString()
            }
        }.getOrNull()
        val project = text?.let { CloudProjects.fromGoogleServicesJson(it, context.packageName) }
        if (project == null) {
            message = importFailed
        } else {
            projectId = project.projectId
            appId = project.appId
            apiKey = project.apiKey
            problems = CloudProjects.problems(project)
            message = importDone
        }
    }

    ScreenColumn(stringResource(R.string.nav_settings)) {
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(stringResource(R.string.settings_cloud_title), style = MaterialTheme.typography.titleMedium)
                LabeledValue(
                    stringResource(R.string.settings_cloud_status),
                    when (cloud.source) {
                        CloudSource.CONNECTED -> stringResource(R.string.settings_cloud_connected, cloud.projectId.orEmpty())
                        CloudSource.BUILT_IN -> stringResource(R.string.settings_cloud_built_in, cloud.projectId.orEmpty())
                        CloudSource.NONE -> stringResource(R.string.settings_cloud_none)
                    },
                )
                Text(stringResource(R.string.settings_cloud_hint), style = MaterialTheme.typography.bodySmall)
                TextButton(onClick = { runCatching { uri.openUri(OWN_PROJECT_GUIDE) } }) {
                    Text(stringResource(R.string.settings_cloud_guide))
                }
                OutlinedButton(onClick = {
                    importFile.launch(arrayOf("application/json", "application/octet-stream", "text/plain"))
                }) { Text(stringResource(R.string.settings_import)) }
                Field(stringResource(R.string.settings_project_id), projectId, CloudProjectProblem.PROJECT_ID in problems) { projectId = it }
                Field(stringResource(R.string.settings_app_id), appId, CloudProjectProblem.APP_ID in problems) { appId = it }
                Field(stringResource(R.string.settings_api_key), apiKey, CloudProjectProblem.API_KEY in problems) { apiKey = it }
                if (problems.isNotEmpty()) {
                    Text(
                        stringResource(R.string.settings_invalid),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error,
                    )
                }
                message?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = {
                        val project = CloudProjects.clean(CloudProject(projectId, appId, apiKey))
                        problems = CloudProjects.problems(project)
                        if (problems.isEmpty()) {
                            store.save(project)
                            CloudSetup.restart(context)
                        }
                    }) { Text(stringResource(R.string.settings_save)) }
                    if (saved != null || cloud.source == CloudSource.CONNECTED) {
                        OutlinedButton(onClick = {
                            store.clear()
                            CloudSetup.restart(context)
                        }) { Text(stringResource(R.string.settings_disconnect)) }
                    }
                }
                Text(stringResource(R.string.settings_restart_hint), style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

@Composable
private fun Field(label: String, value: String, invalid: Boolean, onChange: (String) -> Unit) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        label = { Text(label) },
        isError = invalid,
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii, autoCorrectEnabled = false),
        modifier = Modifier.fillMaxWidth(),
    )
}

/** Reads at most [limit] bytes (InputStream.readNBytes needs API 33). */
private fun java.io.InputStream.readNBytesCompat(limit: Int): ByteArray {
    val out = java.io.ByteArrayOutputStream()
    val buffer = ByteArray(4096)
    while (out.size() < limit) {
        val n = read(buffer, 0, minOf(buffer.size, limit - out.size()))
        if (n < 0) break
        out.write(buffer, 0, n)
    }
    return out.toByteArray()
}

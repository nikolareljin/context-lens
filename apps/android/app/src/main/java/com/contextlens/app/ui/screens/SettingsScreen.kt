package com.contextlens.app.ui.screens

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
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
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import android.content.ClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import com.contextlens.app.R
import com.contextlens.app.firebase.CloudProject
import com.contextlens.app.firebase.CloudProjectProblem
import com.contextlens.app.firebase.CloudProjectStore
import com.contextlens.app.firebase.CloudProjects
import com.contextlens.app.firebase.CloudSetup
import com.contextlens.app.firebase.CloudSource
import com.contextlens.app.firebase.CloudState
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning

/** Saves the marked fields by name, so a rotation keeps them. */
private val problemsSaver = Saver<Set<CloudProjectProblem>, ArrayList<String>>(
    save = { set -> ArrayList(set.map { it.name }) },
    restore = { names -> names.map { CloudProjectProblem.valueOf(it) }.toSet() },
)

/** Step-by-step guide for creating a project for the cloud check. */
private const val OWN_PROJECT_GUIDE = "https://nikolareljin.github.io/context-lens/docs/own-project/"

/** Largest file read as a google-services.json; real ones are about 1 KB. */
private const val MAX_CONFIG_BYTES = 64 * 1024

@Composable
fun SettingsScreen(cloud: CloudState, store: CloudProjectStore) {
    val context = LocalContext.current
    val uri = LocalUriHandler.current
    val saved = remember { store.load() }
    // Saveable, so a rotation keeps what was typed or imported.
    var projectId by rememberSaveable { mutableStateOf(saved?.projectId.orEmpty()) }
    var appId by rememberSaveable { mutableStateOf(saved?.appId.orEmpty()) }
    var apiKey by rememberSaveable { mutableStateOf(saved?.apiKey.orEmpty()) }
    // Saveable too, so a rotation keeps the marks and the last message.
    var problems by rememberSaveable(stateSaver = problemsSaver) { mutableStateOf(emptySet<CloudProjectProblem>()) }
    var message by rememberSaveable { mutableStateOf<String?>(null) }
    val importFailed = stringResource(R.string.settings_import_failed)
    val importDone = stringResource(R.string.settings_import_done)
    val reopen = stringResource(R.string.settings_reopen)
    val codeInvalid = stringResource(R.string.settings_code_invalid)
    val scanUnavailable = stringResource(R.string.settings_scan_unavailable)
    // A project from a connect code, waiting for the user to confirm. Not saveable: the key
    // is not written to the saved state for a dialog.
    var offer by remember { mutableStateOf<CloudProject?>(null) }

    /** A scanned or pasted connect code: asks before anything changes. */
    fun takeCode(text: String?) {
        val project = text?.let { CloudProjects.fromConnectCode(it) }
        if (project == null) message = codeInvalid else offer = project
    }

    fun connect(project: CloudProject) {
        store.save(project)
        if (!CloudSetup.restart(context)) message = reopen
    }

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

    offer?.let { project ->
        AlertDialog(
            onDismissRequest = { offer = null },
            title = { Text(stringResource(R.string.settings_code_confirm_title, project.projectId)) },
            text = {
                Text(
                    stringResource(
                        R.string.settings_code_confirm_text,
                        project.projectId,
                        cloud.projectId ?: stringResource(R.string.settings_code_confirm_none),
                    ),
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    offer = null
                    connect(project)
                }) { Text(stringResource(R.string.settings_code_connect)) }
            },
            dismissButton = { TextButton(onClick = { offer = null }) { Text(stringResource(R.string.settings_code_cancel)) } },
        )
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
                Text(stringResource(R.string.settings_code_hint), style = MaterialTheme.typography.bodySmall)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = {
                        // Google's scanner runs in Play services; the code goes only to this app.
                        val options = GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()
                        GmsBarcodeScanning.getClient(context, options).startScan()
                            .addOnSuccessListener { takeCode(it.rawValue) }
                            .addOnFailureListener { message = scanUnavailable }
                    }) { Text(stringResource(R.string.settings_scan_code)) }
                    OutlinedButton(onClick = {
                        val clipboard = context.getSystemService(ClipboardManager::class.java)
                        val text = clipboard?.primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(context)?.toString()
                        val project = text?.let { CloudProjects.fromConnectCode(it) }
                        // The code carries a key: it does not stay on the clipboard once read.
                        if (project != null) runCatching { clipboard.clearPrimaryClip() }
                        takeCode(text)
                    }) { Text(stringResource(R.string.settings_paste_code)) }
                    OutlinedButton(onClick = {
                        importFile.launch(arrayOf("application/json", "application/octet-stream", "text/plain"))
                    }) { Text(stringResource(R.string.settings_import)) }
                }
                Field(stringResource(R.string.settings_project_id), projectId, CloudProjectProblem.PROJECT_ID in problems) {
                    projectId = it
                    problems = problems - CloudProjectProblem.PROJECT_ID
                }
                Field(stringResource(R.string.settings_app_id), appId, CloudProjectProblem.APP_ID in problems) {
                    appId = it
                    problems = problems - CloudProjectProblem.APP_ID
                }
                Field(stringResource(R.string.settings_api_key), apiKey, CloudProjectProblem.API_KEY in problems, secret = true) {
                    apiKey = it
                    problems = problems - CloudProjectProblem.API_KEY
                }
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
                            if (!CloudSetup.restart(context)) message = reopen
                        }
                    }) { Text(stringResource(R.string.settings_save)) }
                    if (saved != null || cloud.source == CloudSource.CONNECTED) {
                        OutlinedButton(onClick = {
                            store.clear()
                            if (!CloudSetup.restart(context)) message = reopen
                        }) { Text(stringResource(R.string.settings_disconnect)) }
                    }
                }
                Text(stringResource(R.string.settings_restart_hint), style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

@Composable
private fun Field(label: String, value: String, invalid: Boolean, secret: Boolean = false, onChange: (String) -> Unit) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        label = { Text(label) },
        isError = invalid,
        singleLine = true,
        // The key is not shown on screen (screenshots, the recents preview).
        visualTransformation = if (secret) PasswordVisualTransformation() else VisualTransformation.None,
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

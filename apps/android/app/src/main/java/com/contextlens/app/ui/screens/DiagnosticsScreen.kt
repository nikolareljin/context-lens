package com.contextlens.app.ui.screens

import android.content.ClipData
import android.os.Build
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalContext
import androidx.compose.runtime.remember
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.contextlens.app.BuildConfig
import com.contextlens.app.R
import com.contextlens.app.ai.ModelGateway
import com.contextlens.app.diagnostics.ModelState
import com.contextlens.app.diagnostics.ReportInfo
import com.contextlens.app.diagnostics.buildReport
import com.contextlens.app.diagnostics.downloadPercent
import com.contextlens.app.diagnostics.label
import com.contextlens.app.firebase.AppCheckProviders
import com.contextlens.app.firebase.AuthState
import com.contextlens.app.firebase.FirebaseSession
import com.contextlens.app.speech.SpeechListener
import kotlinx.coroutines.launch

@Composable
private fun Section(content: @Composable () -> Unit) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) { content() }
    }
}

@Composable
fun DiagnosticsScreen(session: FirebaseSession, models: ModelGateway) {
    val auth by session.auth.collectAsState()
    val model by models.state.collectAsState()
    val modelName by models.onDeviceName.collectAsState()
    val cloudModel by models.cloudModel.collectAsState()
    val busy by models.busy.collectAsState()
    val calls by models.log.entries.collectAsState()
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val onDeviceSpeech = remember { SpeechListener.isOnDeviceAvailable(context) }

    // First visit: ask the phone once; later visits keep the last answer.
    LaunchedEffect(Unit) { if (model == ModelState.Unknown) models.checkStatus() }

    val device = "${Build.MANUFACTURER} ${Build.MODEL}, Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})"
    val signIn = when (val a = auth) {
        AuthState.SigningIn -> stringResource(R.string.auth_signing_in)
        is AuthState.SignedIn -> stringResource(if (a.anonymous) R.string.auth_anonymous else R.string.auth_signed_in)
        is AuthState.Failed -> stringResource(R.string.auth_failed, a.reason)
    }

    ScreenColumn(stringResource(R.string.nav_diagnostics)) {
        Section {
            LabeledValue(stringResource(R.string.diag_app_version), BuildConfig.VERSION_NAME)
            LabeledValue(stringResource(R.string.diag_device), device)
            LabeledValue(stringResource(R.string.diag_app_check), AppCheckProviders.choice.label)
            LabeledValue(stringResource(R.string.diag_auth), signIn)
            LabeledValue(
                stringResource(R.string.diag_speech),
                stringResource(if (onDeviceSpeech) R.string.diag_speech_yes else R.string.diag_speech_no),
            )
        }

        Section {
            Text(stringResource(R.string.diag_model_title), style = MaterialTheme.typography.titleMedium)
            LabeledValue(stringResource(R.string.diag_model_status), model.label() + (modelName?.let { " ($it)" } ?: ""))
            val downloading = model as? ModelState.Downloading
            if (downloading != null) {
                val percent = downloadPercent(downloading.done, downloading.total)
                if (percent != null) {
                    LinearProgressIndicator(progress = { percent / 100f }, modifier = Modifier.fillMaxWidth())
                } else {
                    LinearProgressIndicator(Modifier.fillMaxWidth())
                }
                Text(stringResource(R.string.diag_download_hint), style = MaterialTheme.typography.bodySmall)
            }
            if (model == ModelState.Unavailable) {
                Text(stringResource(R.string.diag_unavailable_hint), style = MaterialTheme.typography.bodySmall)
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = { models.checkStatus() }, enabled = !busy) {
                    Text(stringResource(R.string.diag_check))
                }
                // A download already running (e.g. started before the app restarted) can be followed again.
                Button(
                    onClick = { models.download() },
                    enabled = !busy && (model == ModelState.Downloadable || model is ModelState.Downloading),
                ) {
                    Text(stringResource(R.string.diag_download))
                }
                OutlinedButton(onClick = { models.warmUp() }, enabled = !busy && model == ModelState.Available) {
                    Text(stringResource(R.string.diag_warm_up))
                }
            }
        }

        Section {
            Text(stringResource(R.string.diag_probe_title), style = MaterialTheme.typography.titleMedium)
            Text(stringResource(R.string.diag_probe_hint), style = MaterialTheme.typography.bodySmall)
            LabeledValue(stringResource(R.string.diag_cloud_model), cloudModel ?: stringResource(R.string.diag_not_tested))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { models.probeOnDevice() }, enabled = !busy && model == ModelState.Available) {
                    Text(stringResource(R.string.diag_probe_device))
                }
                Button(onClick = { models.probeCloud() }, enabled = !busy) {
                    Text(stringResource(R.string.diag_probe_cloud))
                }
            }
        }

        Section {
            Text(stringResource(R.string.diag_calls_title), style = MaterialTheme.typography.titleMedium)
            if (calls.isEmpty()) {
                Text(stringResource(R.string.diag_calls_empty), style = MaterialTheme.typography.bodyMedium)
            }
            calls.forEach { c ->
                Text(
                    "${c.tier} · ${c.model} → ${c.source ?: "–"} · ${c.latencyMs} ms\n${c.outcome}",
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }

        OutlinedButton(
            onClick = {
                val report = buildReport(
                    ReportInfo(
                        appVersion = BuildConfig.VERSION_NAME,
                        device = device,
                        appCheck = AppCheckProviders.choice.label,
                        signIn = signIn,
                        model = model,
                        onDeviceModelName = modelName,
                        cloudModel = cloudModel,
                        calls = calls,
                    ),
                )
                scope.launch { clipboard.setClipEntry(ClipEntry(ClipData.newPlainText("ContextLens diagnostics", report))) }
            },
        ) { Text(stringResource(R.string.diag_copy_report)) }
    }
}

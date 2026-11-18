package com.contextlens.app.ui.screens

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.AssistChip
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.InputChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import com.contextlens.app.R
import com.contextlens.app.context.RegionLocator
import com.contextlens.app.context.SessionContextManager
import com.contextlens.app.domain.DemoRunner
import com.contextlens.app.domain.HybridContextPipeline
import com.contextlens.app.domain.PrivacyMode
import com.contextlens.app.speech.ListenState
import com.contextlens.app.speech.SpeechListener
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

@Composable
fun ListenScreen(session: SessionContextManager, pipeline: HybridContextPipeline, demo: DemoRunner) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val ctx by session.state.collectAsState()
    val speech = remember { SpeechListener(context.applicationContext) }
    val locator = remember { RegionLocator(context.applicationContext) }
    val listen by speech.state.collectAsState()
    val partial by speech.partial.collectAsState()
    val checks by pipeline.checks.collectAsState()
    val chosenMode by pipeline.mode.collectAsState()
    // Without a Firebase project nothing can leave the phone, so the app is in Strict mode.
    val connected = pipeline.cloudConnected
    val mode = if (connected) chosenMode else PrivacyMode.STRICT
    val counts by pipeline.counts.collectAsState()
    val demoRunning by demo.running.collectAsState()
    // Not saveable: typed speech must not reach saved instance state on disk.
    var typed by remember { mutableStateOf("") }
    var micDenied by remember { mutableStateOf(false) }
    var locating by remember { mutableStateOf(false) }
    var locateJob by remember { mutableStateOf<Job?>(null) }
    var regionMessage by remember { mutableStateOf<String?>(null) }
    val onDeviceSpeech = remember { SpeechListener.isOnDeviceAvailable(context) }
    val noArea = stringResource(R.string.listen_area_not_found)

    LaunchedEffect(speech) { speech.utterances.collect { pipeline.submit(it) } }
    DisposableEffect(speech) { onDispose { speech.stop() } }
    // Leaving the app stops the microphone; Android blocks it in the background anyway.
    LifecycleEventEffect(Lifecycle.Event.ON_STOP) { speech.stop() }

    fun findArea() {
        locating = true
        locateJob = scope.launch {
            try {
                val region = runCatching { locator.locate() }.getOrNull()
                // The demo's fictional town must not be replaced by a real one on camera.
                if (demo.running.value) return@launch
                if (region != null) session.setRegion(region)
                regionMessage = if (region == null) noArea else null
            } finally {
                locating = false
            }
        }
    }

    val micPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        micDenied = !granted
        if (granted) speech.start()
    }
    val locationPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) findArea()
    }

    ScreenColumn(stringResource(R.string.nav_listen)) {
        // Context bar: what turns a sentence into a checkable question, and the privacy mode.
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            // Strict keeps raw speech on the phone; Balanced may fall back to the cloud.
            FilterChip(
                selected = mode == PrivacyMode.STRICT,
                enabled = connected,
                onClick = { pipeline.setMode(if (mode == PrivacyMode.STRICT) PrivacyMode.BALANCED else PrivacyMode.STRICT) },
                // A fixed label with an on/off state, so "selected" always means Strict is on.
                label = { Text(stringResource(R.string.mode_strict_chip)) },
                leadingIcon = if (mode == PrivacyMode.STRICT) {
                    { Icon(Icons.Filled.Lock, contentDescription = null, modifier = Modifier.size(FilterChipDefaults.IconSize)) }
                } else {
                    null
                },
            )
            AssistChip(onClick = {}, label = { Text(ctx.today.toString()) })
            val region = ctx.region
            if (region != null) {
                InputChip(
                    selected = true,
                    onClick = { session.setRegion(null) },
                    label = { Text(region.label()) },
                    trailingIcon = { Text("×") },
                )
            } else {
                AssistChip(
                    enabled = !locating,
                    onClick = {
                        if (locator.hasPermission()) findArea()
                        else locationPermission.launch(Manifest.permission.ACCESS_COARSE_LOCATION)
                    },
                    label = { Text(stringResource(if (locating) R.string.listen_area_locating else R.string.listen_area_set)) },
                )
            }
            ctx.pinnedTopic?.let { topic ->
                InputChip(
                    selected = true,
                    onClick = { session.unpin() },
                    label = { Text(stringResource(R.string.listen_pinned, topic)) },
                    trailingIcon = { Text("×") },
                )
            }
        }
        Text(
            stringResource(
                when {
                    !connected -> R.string.mode_phone_only
                    mode == PrivacyMode.STRICT -> R.string.mode_strict
                    else -> R.string.mode_balanced
                },
            ),
            style = MaterialTheme.typography.bodySmall,
        )
        regionMessage?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
        Text(stringResource(R.string.listen_area_hint), style = MaterialTheme.typography.bodySmall)

        PrivacyCounters(counts)

        // Microphone: on-device recognition only.
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (!onDeviceSpeech) {
                    Text(stringResource(R.string.listen_no_on_device_speech), style = MaterialTheme.typography.bodyMedium)
                } else if (listen == ListenState.Listening) {
                    Button(onClick = { speech.stop() }) { Text(stringResource(R.string.listen_stop)) }
                    Text(partial.ifEmpty { stringResource(R.string.listen_listening) }, style = MaterialTheme.typography.bodyLarge)
                } else {
                    Button(onClick = {
                        val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
                            PackageManager.PERMISSION_GRANTED
                        demo.stop()
                        if (granted) speech.start() else micPermission.launch(Manifest.permission.RECORD_AUDIO)
                    }) { Text(stringResource(R.string.listen_start)) }
                    if (micDenied) {
                        Text(stringResource(R.string.listen_mic_denied), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                    }
                    (listen as? ListenState.Stopped)?.let {
                        Text(it.reason, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                    }
                }
            }
        }

        // Manual bar: type a sentence, or pin it as the topic.
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(
                value = typed,
                onValueChange = { typed = it },
                modifier = Modifier.weight(1f),
                label = { Text(stringResource(R.string.listen_type_hint)) },
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                keyboardActions = KeyboardActions(onSend = { pipeline.submit(typed); typed = "" }),
            )
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { pipeline.submit(typed); typed = "" }, enabled = typed.isNotBlank()) {
                Text(stringResource(R.string.listen_add))
            }
            OutlinedButton(onClick = { session.pin(typed); typed = "" }, enabled = typed.isNotBlank()) {
                Text(stringResource(R.string.listen_pin))
            }
            OutlinedButton(onClick = { speech.stop(); demo.stop(); pipeline.clear(); session.clear() }) {
                Text(stringResource(R.string.listen_clear))
            }
        }

        // Demo script: a fixed conversation through the real pipeline, for takes and for trying it silently.
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            if (demoRunning) {
                OutlinedButton(onClick = { demo.stop() }) { Text(stringResource(R.string.demo_stop)) }
            } else {
                OutlinedButton(onClick = { speech.stop(); locateJob?.cancel(); demo.start() }) { Text(stringResource(R.string.demo_start)) }
            }
            Text(stringResource(R.string.demo_hint), style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
        }

        // Each sentence and what happened to it.
        if (checks.isEmpty()) {
            Text(stringResource(R.string.listen_empty), style = MaterialTheme.typography.bodyLarge)
        }
        checks.forEach { check -> CheckCard(check, ctx.today) }
    }
}

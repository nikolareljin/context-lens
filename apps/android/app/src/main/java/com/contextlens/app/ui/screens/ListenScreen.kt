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
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AssistChip
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
import com.contextlens.app.context.DateResolver
import com.contextlens.app.context.RegionLocator
import com.contextlens.app.context.SessionContextManager
import com.contextlens.app.speech.ListenState
import com.contextlens.app.speech.SpeechListener
import kotlinx.coroutines.launch

@Composable
fun ListenScreen(session: SessionContextManager) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val ctx by session.state.collectAsState()
    val speech = remember { SpeechListener(context.applicationContext) }
    val locator = remember { RegionLocator(context.applicationContext) }
    val listen by speech.state.collectAsState()
    val partial by speech.partial.collectAsState()
    // Not saveable: typed speech must not reach saved instance state on disk.
    var typed by remember { mutableStateOf("") }
    var micDenied by remember { mutableStateOf(false) }
    var locating by remember { mutableStateOf(false) }
    var regionMessage by remember { mutableStateOf<String?>(null) }
    val onDeviceSpeech = remember { SpeechListener.isOnDeviceAvailable(context) }
    val noArea = stringResource(R.string.listen_area_not_found)

    LaunchedEffect(speech) { speech.utterances.collect { session.addUtterance(it) } }
    DisposableEffect(speech) { onDispose { speech.stop() } }
    // Leaving the app stops the microphone; Android blocks it in the background anyway.
    LifecycleEventEffect(Lifecycle.Event.ON_STOP) { speech.stop() }

    fun findArea() {
        locating = true
        scope.launch {
            try {
                val region = runCatching { locator.locate() }.getOrNull()
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
        // Context bar: what turns a sentence into a checkable question.
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
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
        regionMessage?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
        Text(stringResource(R.string.listen_area_hint), style = MaterialTheme.typography.bodySmall)

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
                keyboardActions = KeyboardActions(onSend = { session.addUtterance(typed); typed = "" }),
            )
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { session.addUtterance(typed); typed = "" }, enabled = typed.isNotBlank()) {
                Text(stringResource(R.string.listen_add))
            }
            OutlinedButton(onClick = { session.pin(typed); typed = "" }, enabled = typed.isNotBlank()) {
                Text(stringResource(R.string.listen_pin))
            }
            OutlinedButton(onClick = { speech.stop(); session.clear() }) {
                Text(stringResource(R.string.listen_clear))
            }
        }

        // The latest sentences, with the date each one refers to.
        if (ctx.recent.isEmpty()) {
            Text(stringResource(R.string.listen_empty), style = MaterialTheme.typography.bodyLarge)
        }
        ctx.recent.asReversed().forEach { sentence ->
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(sentence, style = MaterialTheme.typography.bodyLarge)
                    DateResolver.resolve(sentence, ctx.today)?.let { m ->
                        val range = if (m.start == m.end) "${m.start}" else "${m.start} – ${m.end}"
                        Text(stringResource(R.string.listen_date_mention, m.phrase, range), style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
    }
}

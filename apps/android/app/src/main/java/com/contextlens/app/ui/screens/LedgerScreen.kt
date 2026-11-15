package com.contextlens.app.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import android.content.ClipData
import com.contextlens.app.R
import com.contextlens.app.domain.HybridContextPipeline
import com.contextlens.app.domain.totals
import java.text.DateFormat
import java.util.Date
import kotlinx.coroutines.launch

/** Every request that left the phone, with the exact text sent. The counters are computed from it. */
@Composable
fun LedgerScreen(pipeline: HybridContextPipeline) {
    val entries by pipeline.ledger.entries.collectAsState()
    val counts by pipeline.counts.collectAsState()
    val totals = entries.totals()
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    val time = DateFormat.getTimeInstance(DateFormat.MEDIUM)

    ScreenColumn(stringResource(R.string.ledger_title)) {
        LabeledValue(stringResource(R.string.ledger_processed), "${counts.processed}")
        LabeledValue(stringResource(R.string.ledger_filtered), "${counts.filtered}")
        LabeledValue(stringResource(R.string.ledger_raw), "${totals.rawBytes} B")
        LabeledValue(stringResource(R.string.ledger_clean), stringResource(R.string.ledger_clean_value, totals.cloudChecks, totals.cleanBytes))
        LabeledValue(stringResource(R.string.ledger_withheld), "${counts.withheld}")
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = {
                scope.launch { clipboard.setClipEntry(ClipEntry(ClipData.newPlainText("ledger", pipeline.ledger.export()))) }
            }, enabled = entries.isNotEmpty()) { Text(stringResource(R.string.ledger_copy)) }
            OutlinedButton(onClick = { pipeline.ledger.clear() }, enabled = entries.isNotEmpty()) {
                Text(stringResource(R.string.ledger_clear))
            }
        }
        if (entries.isEmpty()) {
            Text(stringResource(R.string.ledger_empty), style = MaterialTheme.typography.bodyLarge)
        }
        entries.forEach { e ->
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(
                        "${time.format(Date(e.atMillis))} · ${e.stage} · ${e.kind.name.lowercase()}",
                        style = MaterialTheme.typography.labelMedium,
                    )
                    Text(
                        "${e.source ?: "?"} · ${e.latencyMs} ms · ${e.bytes} B · ${e.model} · prompt ${e.promptVersion} · ${e.outcome}",
                        style = MaterialTheme.typography.bodySmall,
                    )
                    Text(e.text, style = MaterialTheme.typography.bodySmall, fontFamily = FontFamily.Monospace)
                }
            }
        }
    }
}

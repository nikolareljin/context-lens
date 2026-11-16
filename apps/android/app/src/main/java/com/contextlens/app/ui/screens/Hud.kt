package com.contextlens.app.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.contextlens.app.R
import com.contextlens.app.domain.PipelineCounts
import com.contextlens.app.domain.Verdict
import com.contextlens.app.ui.theme.Cyan
import com.contextlens.app.ui.theme.Emerald
import com.contextlens.app.ui.theme.Slate400
import com.contextlens.app.ui.theme.Violet

private val Amber = Color(0xFFF59E0B)
private val Red = Color(0xFFEF4444)

/** Where a reply was computed, as Firebase AI Logic reported it: cyan on the phone, violet in the cloud. */
internal fun sourceColor(source: String?): Color = when (source) {
    "ON_DEVICE" -> Cyan
    "IN_CLOUD" -> Violet
    else -> Slate400
}

internal fun verdictColor(v: Verdict): Color = when (v) {
    Verdict.VERIFIED -> Emerald
    Verdict.NUANCED -> Amber
    Verdict.FALSE -> Red
    Verdict.INSUFFICIENT_EVIDENCE -> Slate400
}

/** A small rounded label tinted with [color]; the text keeps the theme's color so it reads in light and dark. */
@Composable
internal fun Tag(text: String, color: Color, modifier: Modifier = Modifier, strong: Boolean = false) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(50),
        color = color.copy(alpha = 0.16f),
        border = BorderStroke(1.dp, color.copy(alpha = 0.7f)),
    ) {
        Text(
            text,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 3.dp),
            style = if (strong) MaterialTheme.typography.labelLarge else MaterialTheme.typography.labelSmall,
            fontWeight = if (strong) FontWeight.SemiBold else null,
        )
    }
}

/**
 * The source pill: inferenceSource verbatim and the time it took. On the phone the
 * model is Gemini Nano; the cloud model is named only when the reply came from it.
 */
@Composable
internal fun SourcePill(source: String?, latencyMs: Long, cloudModel: String, extra: String? = null) {
    val who = if (source == "ON_DEVICE") "Gemini Nano" else cloudModel
    val text = listOfNotNull(source ?: "?", "$latencyMs ms", who, extra).joinToString(" · ")
    Tag(text, sourceColor(source))
}

@Composable
internal fun VerdictBadge(label: String, verdict: Verdict) {
    Tag(label, verdictColor(verdict), strong = true)
}

/**
 * The privacy counters for this session. Raw text sent adds up the bytes of every
 * request the pipeline records as raw text; anything above 0 B shows in red.
 */
@Composable
internal fun PrivacyCounters(counts: PipelineCounts) {
    // All three count from the start of the session, kept by the pipeline; the Ledger tab keeps every request.
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Counter(stringResource(R.string.hud_local), "${counts.readOnPhone}", Cyan, Modifier.weight(1f))
        Counter(
            stringResource(R.string.hud_raw),
            "${counts.rawBytes} B",
            if (counts.rawBytes == 0) Emerald else Red,
            Modifier.weight(1f),
        )
        Counter(stringResource(R.string.hud_cloud), "${counts.checked}", Violet, Modifier.weight(1f))
    }
}

@Composable
private fun Counter(label: String, value: String, color: Color, modifier: Modifier) {
    Surface(
        modifier = modifier.clearAndSetSemantics { contentDescription = "$value $label" },
        shape = RoundedCornerShape(12.dp),
        color = color.copy(alpha = 0.10f),
        border = BorderStroke(1.dp, color.copy(alpha = 0.5f)),
    ) {
        Column(Modifier.padding(horizontal = 10.dp, vertical = 8.dp)) {
            Text(value, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
            Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

package com.contextlens.app.ui.screens

import android.graphics.Color
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color as ComposeColor
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.UriHandler
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import com.contextlens.app.R
import com.contextlens.app.context.DateResolver
import com.contextlens.app.domain.Check
import com.contextlens.app.domain.HybridContextPipeline.Companion.ON_DEVICE
import com.contextlens.app.domain.Stage
import com.contextlens.app.domain.Verdict
import com.contextlens.app.domain.searchUrl
import com.contextlens.app.ui.theme.Cyan
import com.contextlens.app.ui.theme.Slate400
import com.contextlens.app.ui.theme.Violet
import java.time.LocalDate

/**
 * One sentence and what happened to it, in three stages: the sentence, the clean
 * question, and the grounded verdict from the cloud. The labels say where each
 * was read or written. Each stage appears once it is reached.
 */
@Composable
fun CheckCard(check: Check, today: LocalDate) {
    val uri = LocalUriHandler.current
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            // Stage 1: the sentence, and whether it left the phone.
            val heard = heardLabel(check)
            StageLabel(stringResource(heard.first), heard.second) {
                if (check.demo) Tag(stringResource(R.string.check_demo), Slate400)
            }
            Text(check.utterance, style = MaterialTheme.typography.bodyLarge)
            DateResolver.resolve(check.utterance, today)?.let { m ->
                val range = if (m.start == m.end) "${m.start}" else "${m.start} – ${m.end}"
                Text(stringResource(R.string.listen_date_mention, m.phrase, range), style = MaterialTheme.typography.bodySmall)
            }

            // Stage 2: the clean question, with the references the gatekeeper resolved.
            check.gate?.takeIf { it.result.hasVerifiableClaim }?.let { gate ->
                HorizontalDivider()
                val where = if (gate.source == ON_DEVICE) R.string.check_stage_query_device else R.string.check_stage_query_cloud
                StageLabel(stringResource(where), sourceColor(gate.source))
                Text(gate.result.sanitizedResolvedQuery, style = MaterialTheme.typography.titleSmall)
                if (gate.result.resolvedReferences.isNotEmpty()) {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        gate.result.resolvedReferences.forEach { Tag(it.replace("->", "→"), Slate400) }
                    }
                }
                SourcePill(gate.source, gate.latencyMs, gate.model)
            }

            // Stage 3: the grounded verdict; the rules have the last word over the model.
            check.card?.let { card ->
                HorizontalDivider()
                StageLabel(stringResource(R.string.check_stage_cloud), sourceColor(card.source))
                VerdictBadge(verdictLabel(card.verdict), card.verdict)
                if (card.modelVerdict != null && card.modelVerdict != card.verdict) {
                    Text(stringResource(R.string.check_no_sources_rule), style = MaterialTheme.typography.bodySmall)
                }
                if (card.summary.isNotEmpty()) Text(card.summary, style = MaterialTheme.typography.bodyMedium)
                card.grounding.citations.forEach { c -> Link("${c.title} (${c.domain})") { uri.openUri(c.uri) } }
                val chip = card.grounding.searchEntryPointHtml
                if (chip != null) {
                    SearchSuggestions(chip, uri)
                } else if (card.grounding.searchQueries.isNotEmpty()) {
                    Text(
                        stringResource(R.string.check_searched, card.grounding.searchQueries.joinToString(" · ")),
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
                SourcePill(card.source, card.latencyMs, card.model, stringResource(R.string.check_grounded))
            }

            // Where the sentence stopped, under the last stage it reached.
            if (check.stage != Stage.DONE) {
                Text(stageText(check), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.secondary)
            }
            if (check.stage == Stage.CLOUD_UNAVAILABLE) {
                val query = check.gate?.result?.sanitizedResolvedQuery.orEmpty()
                Link(stringResource(R.string.check_search_this)) { uri.openUri(searchUrl(query)) }
            }
        }
    }
}

/**
 * What the first stage may claim. "Sent to cloud Gemini" whenever the pipeline
 * recorded the sentence as raw text sent; "stays on this phone" only when the local
 * rules stopped it or the gatekeeper reported ON_DEVICE; otherwise just "Heard".
 */
private fun heardLabel(check: Check): Pair<Int, ComposeColor> = when {
    check.sentToCloud -> R.string.check_stage_sent to Violet
    check.stage == Stage.FILTERED || check.stage == Stage.NEEDS_MODEL || check.gate?.source == ON_DEVICE ->
        R.string.check_stage_phone to Cyan
    else -> R.string.check_stage_heard to Slate400
}

/** A stage heading with a colored dot: cyan for the phone, violet for the cloud. */
@Composable
private fun StageLabel(text: String, color: ComposeColor, trailing: @Composable () -> Unit = {}) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Box(Modifier.size(8.dp).background(color, CircleShape))
        Text(text, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        trailing()
    }
}

@Composable
private fun Link(text: String, open: () -> Unit) {
    Text(
        text,
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.primary,
        textDecoration = TextDecoration.Underline,
        modifier = Modifier.clickable { runCatching(open) },
    )
}

/**
 * Google's Search Suggestions chip, shown as Google renders it with every grounded
 * result. JavaScript and network loads stay off; a tap opens the search in the
 * user's browser.
 */
@Composable
private fun SearchSuggestions(html: String, uri: UriHandler) {
    AndroidView(
        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
        factory = { context ->
            WebView(context).apply {
                setBackgroundColor(Color.TRANSPARENT)
                settings.javaScriptEnabled = false
                // The chip is inline HTML; nothing loads from the network unrecorded.
                settings.blockNetworkLoads = true
                settings.allowFileAccess = false
                webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                        runCatching { uri.openUri(request.url.toString()) }
                        return true
                    }
                }
            }
        },
        onRelease = { it.destroy() },
        update = { view ->
            if (view.tag != html) {
                view.tag = html
                view.loadDataWithBaseURL(null, html, "text/html", "utf-8", null)
            }
        },
    )
}

private fun pill(source: String?, latencyMs: Long, model: String): String = "${source ?: "?"} · $latencyMs ms · $model"

@Composable
private fun stageText(check: Check): String = when (check.stage) {
    Stage.FILTERED -> stringResource(R.string.check_filtered, check.note.orEmpty())
    // The note says when the phone's model refused for quota and the call is waiting to retry.
    Stage.GATEKEEPING -> check.note ?: stringResource(R.string.check_gatekeeping)
    Stage.NO_CLAIM -> stringResource(R.string.check_no_claim, check.gate?.let { pill(it.source, it.latencyMs, it.model) }.orEmpty())
    Stage.NEEDS_MODEL -> stringResource(R.string.check_needs_model)
    Stage.WITHHELD -> stringResource(R.string.check_withheld, check.withheld.joinToString { it.name.lowercase() })
    Stage.VERIFYING -> stringResource(R.string.check_verifying)
    Stage.CLOUD_UNAVAILABLE -> stringResource(R.string.check_cloud_unavailable)
    Stage.DONE -> stringResource(R.string.check_done)
    Stage.FAILED -> stringResource(R.string.check_failed, check.note.orEmpty())
}

@Composable
private fun verdictLabel(v: Verdict): String = stringResource(
    when (v) {
        Verdict.VERIFIED -> R.string.verdict_verified
        Verdict.NUANCED -> R.string.verdict_nuanced
        Verdict.FALSE -> R.string.verdict_false
        Verdict.INSUFFICIENT_EVIDENCE -> R.string.verdict_insufficient
    },
)

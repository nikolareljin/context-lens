package com.contextlens.app.ui.screens

import android.graphics.Color
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.UriHandler
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import com.contextlens.app.R
import com.contextlens.app.context.DateResolver
import com.contextlens.app.domain.Check
import com.contextlens.app.domain.Stage
import com.contextlens.app.domain.Verdict
import com.contextlens.app.domain.searchUrl
import java.time.LocalDate

/**
 * One sentence and what happened to it: the sentence (stays on the phone), the
 * clean question written on the device, and the grounded verdict from the cloud.
 * The full split-card layout comes with the HUD; this shows every stage plainly.
 */
@Composable
fun CheckCard(check: Check, today: LocalDate) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(check.utterance, style = MaterialTheme.typography.bodyLarge)
            DateResolver.resolve(check.utterance, today)?.let { m ->
                val range = if (m.start == m.end) "${m.start}" else "${m.start} – ${m.end}"
                Text(stringResource(R.string.listen_date_mention, m.phrase, range), style = MaterialTheme.typography.bodySmall)
            }
            Text(stageText(check), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.secondary)

            check.gate?.takeIf { it.result.hasVerifiableClaim }?.let { gate ->
                HorizontalDivider()
                Text(gate.result.sanitizedResolvedQuery, style = MaterialTheme.typography.titleSmall)
                if (gate.result.resolvedReferences.isNotEmpty()) {
                    Text(gate.result.resolvedReferences.joinToString(" · "), style = MaterialTheme.typography.bodySmall)
                }
                Text(pill(gate.source, gate.latencyMs, gate.model), style = MaterialTheme.typography.labelSmall)
            }

            if (check.stage == Stage.CLOUD_UNAVAILABLE) {
                val query = check.gate?.result?.sanitizedResolvedQuery.orEmpty()
                val uri = LocalUriHandler.current
                Text(
                    stringResource(R.string.check_search_this),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.primary,
                    textDecoration = TextDecoration.Underline,
                    modifier = Modifier.clickable { runCatching { uri.openUri(searchUrl(query)) } },
                )
            }

            check.card?.let { card ->
                HorizontalDivider()
                Text(verdictLabel(card.verdict), style = MaterialTheme.typography.titleMedium, color = verdictColor(card.verdict))
                if (card.modelVerdict != null && card.modelVerdict != card.verdict) {
                    Text(stringResource(R.string.check_no_sources_rule), style = MaterialTheme.typography.bodySmall)
                }
                if (card.summary.isNotEmpty()) Text(card.summary, style = MaterialTheme.typography.bodyMedium)
                val uri = LocalUriHandler.current
                card.grounding.citations.forEach { c ->
                    Text(
                        "${c.title} (${c.domain})",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.primary,
                        textDecoration = TextDecoration.Underline,
                        modifier = Modifier.clickable { runCatching { uri.openUri(c.uri) } },
                    )
                }
                val chip = card.grounding.searchEntryPointHtml
                if (chip != null) {
                    SearchSuggestions(chip, uri)
                } else if (card.grounding.searchQueries.isNotEmpty()) {
                    Text(
                        stringResource(R.string.check_searched, card.grounding.searchQueries.joinToString(" · ")),
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
                Text(pill(card.source, card.latencyMs, card.model) + " · " + stringResource(R.string.check_grounded), style = MaterialTheme.typography.labelSmall)
            }
        }
    }
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
    Stage.GATEKEEPING -> stringResource(R.string.check_gatekeeping)
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

@Composable
private fun verdictColor(v: Verdict) = when (v) {
    Verdict.VERIFIED -> MaterialTheme.colorScheme.primary
    Verdict.FALSE -> MaterialTheme.colorScheme.error
    else -> MaterialTheme.colorScheme.onSurfaceVariant
}

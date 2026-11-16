package com.contextlens.app.domain

import java.net.URI

/** One web chunk from the grounding metadata, before checks. */
data class WebSource(val uri: String?, val title: String?, val domain: String?)

/** Reads web sources and the Search Suggestions chip out of grounding metadata. */
object GroundingParser {
    const val CITATIONS_MAX = 5

    fun parse(sources: List<WebSource>, searchQueries: List<String>, searchEntryPointHtml: String?): Grounding {
        val citations = sources
            .mapNotNull { web ->
                val uri = web.uri?.trim()?.takeIf { it.startsWith("https://") } ?: return@mapNotNull null
                val domain = web.domain?.trim()?.takeIf { it.isNotEmpty() } ?: host(uri)
                Citation(title = web.title?.trim()?.takeIf { it.isNotEmpty() } ?: domain, uri = uri, domain = domain)
            }
            .distinctBy { it.uri }
            .take(CITATIONS_MAX)
        return Grounding(
            citations = citations,
            searchQueries = searchQueries.map { it.trim() }.filter { it.isNotEmpty() },
            searchEntryPointHtml = searchEntryPointHtml?.takeIf { it.isNotBlank() },
        )
    }

    // Parses the host for display; nothing is fetched.
    // foxguard: ignore[kt/no-ssrf]
    private fun host(uri: String): String = runCatching { URI(uri).host }.getOrNull().orEmpty()
}

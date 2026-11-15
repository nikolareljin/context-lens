package com.contextlens.app.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class GroundingParserTest {
    @Test
    fun keepsHttpsSourcesOnceWithATitle() {
        val g = GroundingParser.parse(
            sources = listOf(
                WebSource("https://example.org/fares", "Fare change", "example.org"),
                WebSource("https://example.org/fares", "Duplicate", "example.org"),
                WebSource("https://news.example.com/a", null, null),
                WebSource("http://insecure.example.net/", "Insecure", null),
                WebSource(null, "No link", null),
            ),
            searchQueries = listOf("springfield bus fares", " "),
            searchEntryPointHtml = "<div>chip</div>",
        )
        assertEquals(
            listOf(
                Citation("Fare change", "https://example.org/fares", "example.org"),
                Citation("news.example.com", "https://news.example.com/a", "news.example.com"),
            ),
            g.citations,
        )
        assertEquals(listOf("springfield bus fares"), g.searchQueries)
        assertEquals("<div>chip</div>", g.searchEntryPointHtml)
    }

    @Test
    fun capsSourcesAndToleratesEmptyMetadata() {
        val many = (1..9).map { WebSource("https://s$it.example.org/", "S$it", "s$it.example.org") }
        assertEquals(GroundingParser.CITATIONS_MAX, GroundingParser.parse(many, emptyList(), null).citations.size)
        val empty = GroundingParser.parse(emptyList(), emptyList(), " ")
        assertEquals(emptyList<Citation>(), empty.citations)
        assertNull(empty.searchEntryPointHtml)
    }
}

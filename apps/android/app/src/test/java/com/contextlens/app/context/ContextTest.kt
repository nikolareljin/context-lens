package com.contextlens.app.context

import java.io.StringReader
import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ContextTest {
    // Saturday
    private val today = LocalDate.of(2026, 11, 14)

    @Test
    fun recentKeepsTheLastThreeCleanUtterances() {
        val m = SessionContextManager { today }
        listOf("one", "  two  words ", "", "three", "four").forEach(m::addUtterance)
        assertEquals(listOf("two words", "three", "four"), m.state.value.recent)
    }

    @Test
    fun pinTrimsAndBlankUnpins() {
        val m = SessionContextManager { today }
        m.pin("  bus fares  ")
        assertEquals("bus fares", m.state.value.pinnedTopic)
        m.pin("   ")
        assertNull(m.state.value.pinnedTopic)
        m.pin("x".repeat(100))
        assertEquals(SessionContextManager.TOPIC_MAX, m.state.value.pinnedTopic!!.length)
    }

    @Test
    fun clearForgetsEverythingButTheDate() {
        val m = SessionContextManager { today }
        m.addUtterance("hello"); m.pin("t"); m.setRegion(Region("Springfield", "Shelby", "US"))
        m.clear()
        assertEquals(SessionContext(today), m.state.value)
    }

    @Test
    fun preambleCarriesDateRegionTopicAndRecent() {
        val ctx = SessionContext(today, Region("Springfield", "Shelby", "US"), "bus fares", listOf("a", "b"))
        assertEquals(
            "Date: 2026-11-14 (Saturday)\nRegion: Springfield, Shelby, US\nTopic: bus fares\nRecent:\n- a\n- b",
            ctx.preamble(),
        )
        assertTrue(SessionContext(today).preamble().endsWith("Region: unknown\nTopic: none\nRecent: none"))
    }

    private val table = """
        Springfield	Shelby	US	40.00	-90.00
        Shelbyville	Shelby	US	40.50	-90.00
        bad row
        Capital City		US	notanumber	1
    """.trimIndent()

    @Test
    fun resolverPicksTheNearestCityAndSkipsBadRows() {
        val r = OfflineRegionResolver.parse(StringReader(table))
        assertEquals(Region("Springfield", "Shelby", "US"), r.resolve(40.1, -90.0))
        assertEquals("Shelbyville", r.resolve(40.4, -90.0)?.city)
    }

    @Test
    fun resolverReturnsNothingFarAway() {
        assertNull(OfflineRegionResolver.parse(StringReader(table)).resolve(0.0, 0.0))
    }

    @Test
    fun distanceIsAboutRight() {
        // one degree of latitude is about 111 km
        assertEquals(111.2, OfflineRegionResolver.distanceKm(40.0, -90.0, 41.0, -90.0), 0.5)
    }

    private fun range(text: String) = DateResolver.resolve(text, today)?.let { it.start to it.end }

    @Test
    fun relativeDays() {
        assertEquals(today to today, range("the vote is today"))
        assertEquals(today.minusDays(1) to today.minusDays(1), range("Yesterday the bridge closed"))
        assertEquals(today.plusDays(1) to today.plusDays(1), range("opens tomorrow"))
    }

    @Test
    fun weeksStartOnMonday() {
        val monday = LocalDate.of(2026, 11, 9)
        assertEquals(monday to monday.plusDays(6), range("this week"))
        assertEquals(monday.minusWeeks(1) to monday.minusDays(1), range("the fare went up last week"))
        assertEquals(null, range("this weekend"))
    }

    @Test
    fun monthsAndYears() {
        assertEquals(LocalDate.of(2026, 10, 1) to LocalDate.of(2026, 10, 31), range("last month"))
        assertEquals(LocalDate.of(2025, 1, 1) to LocalDate.of(2025, 12, 31), range("last year"))
    }

    @Test
    fun weekdaysMeanTheMostRecentOneBeforeToday() {
        assertEquals(LocalDate.of(2026, 11, 9).let { it to it }, range("on Monday the council voted"))
        // today is Saturday: "Saturday" means a week ago
        assertEquals(LocalDate.of(2026, 11, 7).let { it to it }, range("last saturday"))
        assertEquals("on Monday", DateResolver.resolve("on Monday it rained", today)?.phrase)
    }

    @Test
    fun nextAndThisLookAtTheRightWeek() {
        // today is Saturday Nov 14; this week runs Nov 9-15
        assertEquals(LocalDate.of(2026, 11, 16).let { it to it }, range("next Monday the vote"))
        assertEquals(LocalDate.of(2026, 11, 20).let { it to it }, range("this coming Friday"))
        assertEquals(LocalDate.of(2026, 11, 13).let { it to it }, range("this Friday"))
        assertEquals(LocalDate.of(2026, 11, 15).let { it to it }, range("this Sunday"))
        assertEquals(LocalDate.of(2026, 11, 9).let { it to it }, range("last  Monday"))
        assertEquals(null, range("on Mondays it is closed"))
    }

    @Test
    fun noDateMeansNull() {
        assertNull(DateResolver.resolve("the bridge is closed", today))
    }
}

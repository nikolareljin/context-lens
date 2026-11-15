package com.contextlens.app.context

import java.time.DayOfWeek
import java.time.LocalDate
import java.time.temporal.TemporalAdjusters

/** A relative date in speech, resolved to an inclusive range. */
data class DateMention(val phrase: String, val start: LocalDate, val end: LocalDate)

/**
 * Resolves relative date phrases ("yesterday", "last week", "on Monday") against
 * today, so a verifier can search for the right period. Weeks start on Monday.
 * "next Friday" looks ahead, "this Friday" means the one in the current week, and
 * any other weekday mention means the most recent one before today.
 * Only the first mention is returned; phrases that need more context are ignored.
 */
object DateResolver {
    private val weekdays = DayOfWeek.entries.associateBy { it.name.lowercase() }

    private val pattern = Regex(
        "\\b(today|tonight|yesterday|tomorrow|this week|last week|next week|this month|last month|" +
            "this year|last year|" +
            "(?:(?:last|this past|next|this coming|this|on)\\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\\b",
        RegexOption.IGNORE_CASE,
    )

    fun resolve(text: String, today: LocalDate): DateMention? {
        val match = pattern.find(text) ?: return null
        val phrase = match.value
        val p = phrase.lowercase()
        val weekStart = today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
        val (start, end) = when (p) {
            "today", "tonight" -> today to today
            "yesterday" -> today.minusDays(1) to today.minusDays(1)
            "tomorrow" -> today.plusDays(1) to today.plusDays(1)
            "this week" -> weekStart to weekStart.plusDays(6)
            "last week" -> weekStart.minusWeeks(1) to weekStart.minusDays(1)
            "next week" -> weekStart.plusWeeks(1) to weekStart.plusWeeks(1).plusDays(6)
            "this month" -> today.withDayOfMonth(1) to today.with(TemporalAdjusters.lastDayOfMonth())
            "last month" -> today.minusMonths(1).withDayOfMonth(1) to
                today.minusMonths(1).with(TemporalAdjusters.lastDayOfMonth())
            "this year" -> today.withDayOfYear(1) to today.with(TemporalAdjusters.lastDayOfYear())
            "last year" -> today.minusYears(1).withDayOfYear(1) to
                today.minusYears(1).with(TemporalAdjusters.lastDayOfYear())
            else -> {
                val words = p.split(Regex("\\s+"))
                val day = weekdays.getValue(words.last())
                val date = when (words.dropLast(1).joinToString(" ")) {
                    "next", "this coming" -> today.with(TemporalAdjusters.next(day))
                    "this" -> weekStart.with(TemporalAdjusters.nextOrSame(day))
                    // "last", "this past", "on" or a bare weekday: the most recent one, today excluded.
                    else -> today.with(TemporalAdjusters.previous(day))
                }
                date to date
            }
        }
        return DateMention(phrase, start, end)
    }
}

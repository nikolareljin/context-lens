package com.contextlens.app.context

import java.time.LocalDate
import java.time.format.TextStyle
import java.util.Locale
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/** A coarse area: the nearest larger city, never coordinates. */
data class Region(val city: String, val area: String, val country: String) {
    fun label(): String = listOf(city, area, country).filter { it.isNotBlank() }.joinToString(", ")
}

/**
 * What the checker knows about the moment, kept in memory only and cleared with
 * the session. It gives a sentence like "the bus fare went up last week" the
 * place, date and topic it needs to become a checkable question.
 */
data class SessionContext(
    val today: LocalDate,
    val region: Region? = null,
    val pinnedTopic: String? = null,
    /** The latest utterances, oldest first, at most [SessionContextManager.RECENT_LIMIT]. */
    val recent: List<String> = emptyList(),
) {
    /** The context block for the on-device gatekeeper prompt. */
    fun preamble(): String = buildString {
        val weekday = today.dayOfWeek.getDisplayName(TextStyle.FULL, Locale.US)
        appendLine("Date: $today ($weekday)")
        appendLine("Region: ${region?.label() ?: "unknown"}")
        appendLine("Topic: ${pinnedTopic ?: "none"}")
        if (recent.isEmpty()) {
            append("Recent: none")
        } else {
            append("Recent:")
            recent.forEach { append("\n- ").append(it) }
        }
    }
}

class SessionContextManager(private val clock: () -> LocalDate = LocalDate::now) {
    private val _state = MutableStateFlow(SessionContext(today = clock()))
    val state: StateFlow<SessionContext> = _state.asStateFlow()

    /** Adds a finished utterance; blank text is ignored. Also refreshes the date. */
    fun addUtterance(text: String) {
        val clean = text.trim().replace(Regex("\\s+"), " ")
        if (clean.isEmpty()) return
        _state.update { it.copy(today = clock(), recent = (it.recent + clean).takeLast(RECENT_LIMIT)) }
    }

    fun pin(topic: String) {
        val clean = topic.trim().take(TOPIC_MAX)
        _state.update { it.copy(pinnedTopic = clean.ifEmpty { null }) }
    }

    fun unpin() = _state.update { it.copy(pinnedTopic = null) }

    fun setRegion(region: Region?) = _state.update { it.copy(region = region) }

    /** Ends the session: everything but the date is forgotten. */
    fun clear() {
        _state.value = SessionContext(today = clock())
    }

    companion object {
        const val RECENT_LIMIT = 3
        const val TOPIC_MAX = 60
    }
}

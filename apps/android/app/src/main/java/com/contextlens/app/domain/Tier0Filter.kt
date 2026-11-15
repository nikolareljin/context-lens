package com.contextlens.app.domain

/**
 * The deterministic first pass. It drops only sentences that are clearly not
 * claims (very short lines, greetings, thanks, apologies, simple requests), so
 * the on-device model is not woken for them. Words that also begin claims
 * ("Please note the tax went up", "Morning traffic doubled") are not openers. Anything in doubt passes on: a
 * missed claim costs more than one extra on-device call.
 */
object Tier0Filter {
    sealed interface Decision {
        data object Pass : Decision
        data class Drop(val reason: String) : Decision
    }

    const val MIN_WORDS = 3

    /** Lines this short that start with a small-talk opener and have no number are dropped. */
    const val SMALL_TALK_MAX_WORDS = 6

    private val word = Regex("[\\p{L}\\p{N}']+")
    private val digit = Regex("\\d")

    private val openers = listOf(
        "hi", "hello", "hey", "good morning", "good afternoon", "good evening", "good night",
        "thanks", "thank you", "sorry", "bye", "goodbye", "see you",
        "can you hear", "can you pass", "could you pass", "let's", "lets",
    )

    /** "Morning!" greets; "Morning traffic doubled" is a claim. */
    private val morningGreeting = Regex("^(?i)morning\\s*[!,.]")

    fun check(text: String): Decision {
        val words = word.findAll(text.lowercase()).map { it.value }.toList()
        if (words.size < MIN_WORDS) return Decision.Drop("too short")
        if (digit.containsMatchIn(text) || words.size > SMALL_TALK_MAX_WORDS) return Decision.Pass
        val joined = words.joinToString(" ")
        val opener = openers.firstOrNull { joined == it || joined.startsWith("$it ") }
        return if (opener != null || morningGreeting.containsMatchIn(text.trim())) Decision.Drop("small talk") else Decision.Pass
    }
}

package com.contextlens.app.domain

enum class PiiKind { EMAIL, PHONE, CARD, IBAN, SSN, ADDRESS, NAME }

/**
 * The deterministic check after the gatekeeper. A hit blocks the cloud call; the
 * query is never repaired and sent anyway. It looks for personal data in the query
 * itself, and for personal data found in the original sentence that the query
 * still carries. Results name only the kind, never the matched text.
 */
object PiiPostScrubber {
    private val email = Regex("[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}")
    private val ssn = Regex("\\b\\d{3}([ -])\\d{2}\\1\\d{4}\\b")
    private val card = Regex("\\b(?:\\d[ -]?){12,18}\\d\\b")
    private val iban = Regex("\\b[A-Z]{2}\\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\\b")
    /**
     * North American numbers with separators, and any "+" number of 7 to 15 digits. The
     * short form takes "-" or "." only and no year after it ("Fortune 500 2024", "737-2018").
     * A range like "200-1500" still matches; it can't be told apart from "555-1500".
     */
    private val phone = Regex(
        "\\+\\d(?:[ .-]?\\d){6,14}\\b" +
            "|(?:\\(\\d{3}\\)|\\b\\d{3})[ .-]?\\d{3}[ .-]\\d{4}\\b" +
            "|\\b\\d{3}[.-](?!(?:1[89]|20)\\d\\d\\b)\\d{4}\\b",
    )

    /**
     * 7 or 10 digits without separators, as speech recognizers often write a phone
     * number. Only looked for in the sentences, never in the query alone: in a question
     * a bare number is far more often a quantity ("2300000 people").
     */
    private val barePhone = Regex("\\b\\d{10}\\b|\\b\\d{7}\\b")

    /** A round number ("500-1000", "8000000") is a quantity, not a phone number. */
    private fun roundNumber(text: String) = text.filter(Char::isDigit).endsWith("000")

    /** A house number: not a year ("the 2008 Wall Street crash"), and never Wall Street itself. */
    private const val HOUSE = "\\b(?!(?:1[89]|20)\\d\\d\\b)\\d{1,5}\\s+(?!Wall\\s+Street\\b)"

    /** A street-name word: not an article or preposition ("40 people block the street"). */
    private const val STREET_WORD = "(?!(?i:the|a|an|on|in|at|of|to|and|or|for|from|by|with|into|down|up|along|across)\\b)"

    /** Capitalized street names with any street type, or one word before a lower-case or unambiguous type ("12 elm street", "42 Maple street"). */
    private val addresses = listOf(
        Regex(
            "$HOUSE(?:$STREET_WORD[A-Z][a-z]+\\s+){1,3}" +
                "(?:Street|St|Lane|Ln|Avenue|Ave|Road|Rd|Court|Ct|Drive|Dr|Boulevard|Blvd|Way|Place|Pl|Terrace|Circle)\\b",
        ),
        Regex("$HOUSE$STREET_WORD[A-Za-z][a-z]+\\s+(?i:street|avenue|boulevard)\\b"),
    )

    /** Public addresses that fact checks name ("10 Downing Street"). */
    private val publicAddresses = Regex("(?i)\\b(?:Wall Street|Downing Street|Pennsylvania Avenue)\\b")

    private const val NAME = "[A-Z][a-z]+(?:['’-][A-Z]?[a-z]+)?"
    private const val PROPER = "[A-Z][A-Za-z]*(?:['’-][A-Z]?[a-z]+)?"

    /**
     * A person named in the sentence: by title, by address form, after "my friend" and
     * the like, or as First Last before a personal verb ("Jenna Liu told me") or a
     * workplace ("Kevin O'Brien from accounting"). Public
     * speech verbs ("said", "says") are not used: "The World Bank said" and "Prime
     * Minister Carney said" are not private people, and the gatekeeper prompt already
     * asks for private names to be left out.
     */
    private val namePatterns = listOf(
        Regex("\\b(?:Dr|Mr|Mrs|Ms|Mx|Prof|Aunt|Uncle|Grandma|Grandpa)\\.?\\s+($NAME)"),
        Regex("^(?:Call|Tell|Text|Email|Ask|Message|Ping|Remind)\\s+($NAME)"),
        Regex(
            "\\b(?i:my|our|his|her|their|your)\\s+(?i:friend|wife|husband|partner|boss|neighbou?r|colleague|coworker|" +
                "brother|sister|mom|mother|dad|father|son|daughter|cousin|doctor|landlord|teacher)\\s+($NAME)",
        ),
        Regex("\\b($NAME\\s+$PROPER)\\s+(?:told (?:me|us)|asked (?:me|us)|texted|called (?:me|us)|mentioned (?:to )?(?:me|us))\\b"),
        Regex("\\b($NAME\\s+$PROPER)\\s+from\\s+(?!(?:the|a|an|his|her|their|our|my|its)\\b)(?=[a-z])"),
    )

    /** Capitalized words that never begin a name ("The Fed said…"). */
    private val notNames = setOf("The", "A", "An", "My", "Our", "Your", "His", "Her", "Their", "This", "That", "These", "Those")

    /** Words that make a capitalized pair an organization, not a person ("Fox News told us"). */
    private val orgWords = setOf(
        "News", "Times", "Post", "Journal", "Press", "Media", "Bank", "Reserve", "Fed", "Council", "Department",
        "Ministry", "University", "College", "Institute", "Party", "Senate", "House", "Court", "Agency", "Office",
        "Group", "Inc", "Corp", "Company", "Foundation", "Association", "Union", "Committee", "Commission",
    )

    /**
     * The kinds of personal data in [query]. [utterance] is the original sentence and
     * [earlier] the sentences the gatekeeper saw before it (it resolves "she" or "that
     * number" from them); [publicNames] (pinned topic, region) are never treated as
     * personal names.
     */
    fun findIn(
        query: String,
        utterance: String,
        publicNames: List<String> = emptyList(),
        earlier: List<String> = emptyList(),
    ): Set<PiiKind> {
        val hits = mutableSetOf<PiiKind>()
        patternHits(query).forEach { hits += it.first }
        // Personal data from the sentences that survived into the query, even partly
        // (a card's first four digits, the end of a phone number). From earlier sentences
        // a part must be 5+ digits, so a phone ending "2026" does not block every question
        // about 2026.
        val sentences = earlier + utterance
        val found = mutableListOf<Pair<PiiKind, String>>()
        sentences.forEachIndexed { i, sentence ->
            val minPart = if (i == sentences.lastIndex) 4 else 5
            patternHits(sentence, bare = true).forEach { hit ->
                found += hit
                val (kind, text) = hit
                val partial = kind in numeric && Regex("\\d{$minPart,}").findAll(text).any { query.contains(it.value) }
                if (query.contains(text) || partial) hits += kind
            }
        }
        val publicText = publicNames.joinToString(" ")
        val addresses = found.filter { it.first == PiiKind.ADDRESS }.joinToString(" ") { it.second }
        fun word(name: String) = Regex("\\b${Regex.escape(name)}\\b")
        sentences.flatMap(::names)
            .filterNot { word(it).containsMatchIn(publicText) || word(it).containsMatchIn(addresses) }
            .forEach { if (word(it).containsMatchIn(query)) hits += PiiKind.NAME }
        return hits
    }

    private val numeric = setOf(PiiKind.PHONE, PiiKind.CARD, PiiKind.IBAN, PiiKind.SSN)

    /** Matches in priority order; a match inside an earlier one (card digits within an IBAN) is skipped. */
    private fun patternHits(text: String, bare: Boolean = false): List<Pair<PiiKind, String>> {
        val taken = mutableListOf<IntRange>()
        val out = mutableListOf<Pair<PiiKind, String>>()
        fun takeSpans(kind: PiiKind, spans: Sequence<Pair<IntRange, String>>) = spans.forEach { (range, value) ->
            if (taken.none { it.first <= range.last && range.first <= it.last }) {
                taken += range
                out += kind to value
            }
        }
        fun take(kind: PiiKind, matches: Sequence<MatchResult>) = takeSpans(kind, matches.map { it.range to it.value })
        take(PiiKind.EMAIL, email.findAll(text))
        take(PiiKind.IBAN, iban.findAll(text))
        take(PiiKind.SSN, ssn.findAll(text))
        takeSpans(PiiKind.CARD, card.findAll(text).mapNotNull(::cardPrefix))
        addresses.forEach { r -> take(PiiKind.ADDRESS, r.findAll(text).filterNot { publicAddresses.containsMatchIn(it.value) }) }
        take(PiiKind.PHONE, phone.findAll(text).filterNot { roundNumber(it.value) })
        if (bare) take(PiiKind.PHONE, barePhone.findAll(text).filterNot { roundNumber(it.value) })
        return out
    }

    /** Single name tokens (first and last names separately). */
    internal fun names(utterance: String): Set<String> =
        namePatterns.flatMap { p -> p.findAll(utterance.trim()).map { it.groupValues[1] }.toList() }
            .map { it.split(Regex("\\s+")) }
            // "The Fed said" is not a First Last.
            .filterNot { it.first() in notNames || it.any(orgWords::contains) }
            .flatten()
            .filter { it.length > 1 }
            .toSet()

    /**
     * The first 13-19 digit window of [m] that passes Luhn, starting at any digit group,
     * so digits right before or after a card number (an expiry date, a CVV, a room
     * number) don't hide it.
     */
    private fun cardPrefix(m: MatchResult): Pair<IntRange, String>? {
        val v = m.value
        val digitAt = v.indices.filter { v[it].isDigit() }
        val groupStarts = digitAt.indices.filter { i -> i == 0 || digitAt[i] != digitAt[i - 1] + 1 }
        for (first in groupStarts) {
            for (count in minOf(digitAt.size - first, 19) downTo 13) {
                val from = digitAt[first]
                val value = v.substring(from, digitAt[first + count - 1] + 1)
                if (luhn(value)) return (m.range.first + from until m.range.first + from + value.length) to value
            }
        }
        return null
    }

    internal fun luhn(candidate: String): Boolean {
        val digits = candidate.filter(Char::isDigit)
        if (digits.length !in 13..19) return false
        var sum = 0
        digits.reversed().forEachIndexed { i, c ->
            var d = c - '0'
            if (i % 2 == 1) {
                d *= 2
                if (d > 9) d -= 9
            }
            sum += d
        }
        return sum % 10 == 0
    }
}

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
    /** North American numbers with separators, and any "+" number of 7 to 15 digits. */
    private val phone = Regex(
        "\\+\\d(?:[ .-]?\\d){6,14}\\b" +
            "|(?:\\(\\d{3}\\)|\\b\\d{3})[ .-]?\\d{3}[ .-]\\d{4}\\b" +
            "|\\b\\d{3}[ .-]\\d{4}\\b",
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

    /** Capitalized street names with any street type, or lower-case ones before an unambiguous type ("12 elm street"). */
    private val addresses = listOf(
        Regex(
            "$HOUSE(?:$STREET_WORD[A-Z][a-z]+\\s+){1,3}" +
                "(?:Street|St|Lane|Ln|Avenue|Ave|Road|Rd|Court|Ct|Drive|Dr|Boulevard|Blvd|Way|Place|Pl|Terrace|Circle)\\b",
        ),
        Regex("$HOUSE(?:$STREET_WORD[A-Za-z][a-z]+\\s+){1,3}(?i:street|avenue|boulevard)\\b"),
    )

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
        Regex("\\b($NAME\\s+$PROPER)\\s+from\\s+(?=[a-z])"),
    )

    /** Capitalized words that never begin a name ("The Fed said…"). */
    private val notNames = setOf("The", "A", "An", "My", "Our", "Your", "His", "Her", "Their", "This", "That", "These", "Those")

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
        sentences.flatMap(::names)
            .filterNot { publicText.contains(it) || addresses.contains(it) }
            .forEach { if (Regex("\\b${Regex.escape(it)}\\b").containsMatchIn(query)) hits += PiiKind.NAME }
        return hits
    }

    private val numeric = setOf(PiiKind.PHONE, PiiKind.CARD, PiiKind.IBAN, PiiKind.SSN)

    /** Matches in priority order; a match inside an earlier one (card digits within an IBAN) is skipped. */
    private fun patternHits(text: String, bare: Boolean = false): List<Pair<PiiKind, String>> {
        val taken = mutableListOf<IntRange>()
        val out = mutableListOf<Pair<PiiKind, String>>()
        fun take(kind: PiiKind, matches: Sequence<MatchResult>) = matches.forEach { m ->
            if (taken.none { it.first <= m.range.last && m.range.first <= it.last }) {
                taken += m.range
                out += kind to m.value
            }
        }
        take(PiiKind.EMAIL, email.findAll(text))
        take(PiiKind.IBAN, iban.findAll(text))
        take(PiiKind.SSN, ssn.findAll(text))
        take(PiiKind.CARD, card.findAll(text).filter { luhn(it.value) })
        addresses.forEach { take(PiiKind.ADDRESS, it.findAll(text)) }
        take(PiiKind.PHONE, phone.findAll(text).filterNot { roundNumber(it.value) })
        if (bare) take(PiiKind.PHONE, barePhone.findAll(text).filterNot { roundNumber(it.value) })
        return out
    }

    /** Single name tokens (first and last names separately). */
    internal fun names(utterance: String): Set<String> =
        namePatterns.flatMap { p -> p.findAll(utterance.trim()).map { it.groupValues[1] }.toList() }
            .map { it.split(Regex("\\s+")) }
            // "The Fed said" is not a First Last.
            .filterNot { it.first() in notNames }
            .flatten()
            .filter { it.length > 1 }
            .toSet()

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

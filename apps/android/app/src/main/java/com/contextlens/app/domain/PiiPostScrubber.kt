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
    private val ssn = Regex("\\b\\d{3}-\\d{2}-\\d{4}\\b")
    private val card = Regex("\\b(?:\\d[ -]?){12,18}\\d\\b")
    private val iban = Regex("\\b[A-Z]{2}\\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\\b")
    private val phone = Regex(
        "(?:\\+\\d{1,3}[ .-]?)?(?:\\(\\d{3}\\)|\\b\\d{3})[ .-]?\\d{3}[ .-]\\d{4}\\b|\\b\\d{3}[ .-]\\d{4}\\b",
    )
    private val address = Regex(
        "\\b\\d{1,5}\\s+(?:[A-Z][a-z]+\\s+){1,3}" +
            "(?:Street|St|Lane|Ln|Avenue|Ave|Road|Rd|Court|Ct|Drive|Dr|Boulevard|Blvd|Way|Place|Pl|Terrace|Circle)\\b",
    )

    private const val NAME = "[A-Z][a-z]+(?:['’-][A-Z]?[a-z]+)?"
    private const val PROPER = "[A-Z][A-Za-z]*(?:['’-][A-Z]?[a-z]+)?"

    /** A person named in the sentence: by title, by address form, or as First Last before a speech verb. */
    private val namePatterns = listOf(
        Regex("\\b(?:Dr|Mr|Mrs|Ms|Mx|Prof|Aunt|Uncle|Grandma|Grandpa)\\.?\\s+($NAME)"),
        Regex("^(?:Call|Tell|Text|Email|Ask|Message|Ping|Remind)\\s+($NAME)"),
        Regex("\\b($NAME\\s+$PROPER)\\s+(?:told|said|says|asked|thinks|mentioned|from)\\b"),
    )

    /**
     * The kinds of personal data in [query]. [utterance] is the original sentence;
     * [publicNames] (pinned topic, region) are never treated as personal names.
     */
    fun findIn(query: String, utterance: String, publicNames: List<String> = emptyList()): Set<PiiKind> {
        val hits = mutableSetOf<PiiKind>()
        patternHits(query).forEach { hits += it.first }
        // Personal data from the sentence that survived into the query, even partly
        // (a card's first four digits, the end of a phone number).
        val found = patternHits(utterance)
        found.forEach { (kind, text) ->
            val partial = kind in numeric && Regex("\\d{4,}").findAll(text).any { query.contains(it.value) }
            if (query.contains(text) || partial) hits += kind
        }
        val publicText = publicNames.joinToString(" ")
        val addresses = found.filter { it.first == PiiKind.ADDRESS }.joinToString(" ") { it.second }
        names(utterance)
            .filterNot { publicText.contains(it) || addresses.contains(it) }
            .forEach { if (Regex("\\b${Regex.escape(it)}\\b").containsMatchIn(query)) hits += PiiKind.NAME }
        return hits
    }

    private val numeric = setOf(PiiKind.PHONE, PiiKind.CARD, PiiKind.IBAN, PiiKind.SSN)

    /** Matches in priority order; a match inside an earlier one (card digits within an IBAN) is skipped. */
    private fun patternHits(text: String): List<Pair<PiiKind, String>> {
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
        take(PiiKind.ADDRESS, address.findAll(text))
        take(PiiKind.PHONE, phone.findAll(text))
        return out
    }

    /** Single name tokens (first and last names separately). */
    internal fun names(utterance: String): Set<String> =
        namePatterns.flatMap { p -> p.findAll(utterance.trim()).map { it.groupValues[1] }.toList() }
            .flatMap { it.split(Regex("\\s+")) }
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

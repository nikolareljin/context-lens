package com.contextlens.app.domain

/**
 * Turns the verifier's text into a card. The model proposes; these rules decide:
 * no web source means "insufficient evidence" whatever the model wrote, an
 * unreadable verdict also means "insufficient evidence", and the summary is cut
 * to two sentences.
 */
object VerdictRules {
    const val SUMMARY_SENTENCES = 2

    private val verdictLine = Regex("(?im)^\\W*verdict\\W*:?\\s*\\**\\s*([A-Z_ ]+)")
    private val summaryLine = Regex("(?is)\\bsummary\\W*:\\s*(.+)")
    private val citationMarks = Regex("\\s*\\[(?:\\d+(?:\\s*[,-]\\s*\\d+)*)]")
    private val abbreviation = Regex("(?:\\b[A-Z]|\\b(?:Mr|Mrs|Ms|Dr|St|vs|etc|No|approx|Jan|Feb|Aug|Sept|Oct|Nov|Dec))\\.$")

    fun parseVerdict(text: String?): Verdict? {
        val raw = text ?: return null
        val token = verdictLine.find(raw)?.groupValues?.get(1)?.trim()?.replace(' ', '_')?.uppercase() ?: return null
        return Verdict.entries.firstOrNull { token.startsWith(it.name) }
    }

    fun parseSummary(text: String?): String {
        val raw = text?.trim().orEmpty()
        val body = summaryLine.find(raw)?.groupValues?.get(1) ?: raw.lineSequence().filterNot { verdictLine.matches(it) }.joinToString(" ")
        val clean = body.replace("**", "").replace(citationMarks, "").replace(Regex("\\s+"), " ").trim()
        return firstSentences(clean, SUMMARY_SENTENCES)
    }

    fun firstSentences(text: String, max: Int): String {
        val parts = text.split(Regex("(?<=[.!?])\\s+"))
        val sentences = mutableListOf<String>()
        for (part in parts) {
            val last = sentences.lastOrNull()
            if (last != null && abbreviation.containsMatchIn(last)) {
                sentences[sentences.lastIndex] = "$last $part"
            } else {
                sentences += part
            }
        }
        return sentences.filter { it.isNotBlank() }.take(max).joinToString(" ")
    }

    fun card(reply: ModelReply, model: String, latencyMs: Long): FactCard {
        val grounding = reply.grounding ?: Grounding(emptyList(), emptyList(), null)
        val proposed = parseVerdict(reply.text)
        val verdict = if (grounding.citations.isEmpty()) Verdict.INSUFFICIENT_EVIDENCE else proposed ?: Verdict.INSUFFICIENT_EVIDENCE
        return FactCard(
            verdict = verdict,
            modelVerdict = proposed,
            summary = parseSummary(reply.text),
            grounding = grounding,
            model = model,
            source = reply.source,
            latencyMs = latencyMs,
        )
    }
}

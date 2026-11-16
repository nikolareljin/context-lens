package com.contextlens.app.domain

import java.io.File
import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Synthetic sentences in the style of the evaluation set: no real people, numbers or addresses. */
class RulesTest {
    private val claims = listOf(
        "The Eiffel Tower is about 330 meters tall.",
        "Rhode Island is the smallest US state by area.",
        "Python was first released in 1991.",
        "They raised it again here last month.",
        "This company had layoffs last year.",
        "Their stock doubled since January.",
        "Didn't Canada legalize cannabis in 2018?",
        "Pluto is still classified as a planet.",
        "Sorry, Rhode Island is the smallest US state.",
        "Call Mark at 555-0134 about the bus fare numbers.",
        "Thanks, the Moon is about 384,000 kilometers away.",
        "Morning traffic doubled this year.",
        "Please note the tax went up.",
    )

    @Test
    fun tier0NeverDropsAClaim() {
        claims.forEach { assertEquals(it, Tier0Filter.Decision.Pass, Tier0Filter.check(it)) }
    }

    @Test
    fun tier0DropsObviousSmallTalk() {
        listOf(
            "Ugh, Mondays.",
            "Morning! Did you sleep okay?",
            "Can you pass me the sugar?",
            "Can you hear me now?",
            "Sorry, I was on mute.",
            "Thanks, see you tomorrow!",
            "Let's grab lunch after this.",
            "",
            "ok",
        ).forEach { assertTrue(it, Tier0Filter.check(it) is Tier0Filter.Decision.Drop) }
    }

    @Test
    fun scrubberCatchesSpokenFormsAndEarlierSentences() {
        fun hits(query: String, utterance: String, earlier: List<String> = emptyList()) =
            PiiPostScrubber.findIn(query, utterance, emptyList(), earlier)

        assertEquals(setOf(PiiKind.PHONE), hits("Did fares rise? 5550001111", "Fares rose, call 5550001111."))
        assertEquals(setOf(PiiKind.SSN), hits("Is fraud up for 123 45 6789?", "Fraud is up."))
        assertEquals(setOf(PiiKind.ADDRESS), hits("Did rent at 12 elm street rise?", "Rent at 12 elm street rose."))
        assertEquals(setOf(PiiKind.NAME), hits("Did Jenna get the tax refund?", "My friend Jenna got the tax refund."))
        // A possessive after a family title, and the name inside an email address.
        assertEquals(setOf(PiiKind.NAME), hits("Did Rosa's house lose value after the zoning law?", "Aunt Rosa's house lost value."))
        assertEquals(setOf(PiiKind.NAME), hits("Is Sam Rivera's EV credit still 7,500?", "Email sam.rivera@example.com if the EV credit is still 7,500."))
        // A generic mailbox names nobody.
        assertEquals(emptySet<PiiKind>(), hits("Is Support for the EV credit ending?", "Write to support@example.com about the EV credit."))
        assertEquals(emptySet<PiiKind>(), hits("Did the City Council raise bus fares?", "Write to city.council@example.org about the bus fares."))
        assertEquals(emptySet<PiiKind>(), hits("Did the Springfield Library cut its hours?", "Ask springfield.library@example.org about the hours."))
        assertEquals(emptySet<PiiKind>(), hits("Did the Board of Education cut hours?", "Write to board.education@example.org about hours."))
        // Real first.last addresses, including surnames that are also common words, tags and initials.
        assertEquals(setOf(PiiKind.NAME), hits("Did Taylor Hall's bus fare rise?", "Email taylor.hall@example.com if fares rose."))
        assertEquals(setOf(PiiKind.NAME), hits("Is Sam Rivera's EV credit still 7,500?", "Email sam.rivera+fares@example.com about the EV credit."))
        assertEquals(setOf(PiiKind.NAME), hits("Did Rivera get the refund?", "Email j.rivera@example.com about the refund."))
        assertEquals(setOf(PiiKind.NAME), hits("Did Taylor get the refund?", "Email taylor.post@example.com about the refund."))
        // Spelling from an email is unknown, so case, apostrophes and hyphens don't matter; digits and long names too.
        assertEquals(setOf(PiiKind.NAME), hits("Did McDonald get the refund?", "Email j.mcdonald@example.com about the refund."))
        assertEquals(setOf(PiiKind.NAME), hits("Did O'Brien get the refund?", "Email j.obrien@example.com about the refund."))
        assertEquals(setOf(PiiKind.NAME), hits("Did Rivera get the refund?", "Email sam.rivera92@example.com about the refund."))
        assertEquals(setOf(PiiKind.NAME), hits("Did Kim get the refund?", "Email kim.sales@example.com about the refund."))
        assertEquals(setOf(PiiKind.NAME), hits("Did Maria get the refund?", "Email maria.de.la.cruz@example.com about the refund."))
        assertEquals(emptySet<PiiKind>(), hits("Did LA raise bus fares?", "Email maria.de.la.cruz@example.com about the fares."))
        assertEquals(emptySet<PiiKind>(), hits("Did the Parks Department close the pool?", "Write to parks.department@example.org about the pool."))
        assertEquals(emptySet<PiiKind>(), hits("Did Town Hall extend its hours?", "Write to town.hall@example.org about hours."))
        // Possessives, hyphenated names, accents and surnames that are also mailbox-like words.
        assertEquals(setOf(PiiKind.NAME), hits("Did Rivera's refund arrive?", "Email j.rivera@example.com about the refund."))
        assertEquals(setOf(PiiKind.NAME), hits("Did Smith-Jones get the refund?", "Email a.smith-jones@example.com about the refund."))
        assertEquals(setOf(PiiKind.NAME), hits("Did Mary-Jane get the refund?", "Email mary-jane.smith@example.com about the refund."))
        assertEquals(setOf(PiiKind.NAME), hits("Did García get the refund?", "Email jose.garcia@example.com about the refund."))
        assertEquals(setOf(PiiKind.NAME), hits("Did Jordan Parks get the refund?", "Email parks.jordan@example.com about the refund."))
        // Role mailboxes name nobody.
        assertEquals(emptySet<PiiKind>(), hits("Did retail sales rise this year?", "Email sales@example.com about the sales figures."))
        assertEquals(emptySet<PiiKind>(), hits("Are there no new toll rules?", "I got mail from no-reply@example.gov about toll rules."))
        assertEquals(emptySet<PiiKind>(), hits("Did the jobs report beat expectations?", "I emailed jobs@example.com about the opening."))
        assertEquals(emptySet<PiiKind>(), hits("Did AWS raise prices?", "I got an email from no-reply-aws@example.com about price changes."))
        assertEquals(emptySet<PiiKind>(), hits("Are payments delayed?", "Mail from payments-noreply@example.com says payments are delayed."))
        assertEquals(emptySet<PiiKind>(), hits("Did the billing rules change?", "Mail came from do_not_reply.billing@example.com about the billing rules."))
        assertEquals(emptySet<PiiKind>(), hits("Did city parks and recreation cut hours?", "Write to parks.recreation@example.org about hours."))
        // Surnames that look like reply words still name someone.
        assertEquals(setOf(PiiKind.NAME), hits("Did Minh get the refund?", "Email do.minh@example.com about the refund."))
        assertEquals(setOf(PiiKind.NAME), hits("Did Kevin O’Brien say revenue grew?", "Kevin O'Brien from accounting said revenue grew."))
        // The gatekeeper resolved "she" from an earlier sentence.
        assertEquals(
            setOf(PiiKind.NAME),
            hits("Did the clinic Jenna Liu mentioned close in October 2026?", "She said it closed last month.", listOf("Jenna Liu told me the clinic is closing.")),
        )
        assertEquals(setOf(PiiKind.PHONE), hits("Is 555-0134 a scam number?", "Is that number a scam?", listOf("They called from 555-0134.")))
        // Organizations and capitalized sentence starts are not names.
        assertEquals(emptySet<PiiKind>(), hits("Did the Fed raise rates in 2026?", "The Fed said rates rose."))
        assertEquals(emptySet<PiiKind>(), hits("Is the US population about 340 million?", "The US has about 340 million people."))
        assertEquals(emptySet<PiiKind>(), hits("Did the Federal Reserve raise rates in 2026?", "Rates went up.", listOf("The World Bank said growth slowed.", "Prime Minister Carney said so too.")))
        assertEquals(emptySet<PiiKind>(), hits("Did flights to New York from Boston double?", "Flights to New York from Boston doubled."))
        // Quantities, years and streets in a question are not addresses or phone numbers.
        assertEquals(emptySet<PiiKind>(), hits("Did 40 people block the street?", "Forty people blocked the street."))
        assertEquals(emptySet<PiiKind>(), hits("Did the 2008 Wall Street crash erase 10 trillion dollars?", "The crash erased trillions."))
        assertEquals(emptySet<PiiKind>(), hits("Did Houston reach 2300000 people?", "Houston has 2300000 people."))
        assertEquals(emptySet<PiiKind>(), hits("Did 500-1000 people attend?", "Hundreds attended."))
        assertEquals(emptySet<PiiKind>(), hits("Did Springfield raise fares in 2026?", "Fares rose this year.", listOf("They called from 555-2026.")))
        assertEquals(emptySet<PiiKind>(), hits("Did the S&P 500 gain 23 percent in 2024?", "The S&P 500 2024 gain was 23 percent."))
        assertEquals(emptySet<PiiKind>(), hits("Does the prime minister live at 10 Downing Street?", "The prime minister lives at 10 Downing Street."))
        assertEquals(emptySet<PiiKind>(), hits("Did 500 protesters occupy Wall Street in 2011?", "Protesters occupied Wall Street."))
        assertEquals(emptySet<PiiKind>(), hits("Did Bernie Sanders say drug prices doubled?", "Bernie Sanders from the Senate floor said drug prices doubled."))
        assertEquals(emptySet<PiiKind>(), hits("Is crime up, as Fox News reported?", "Fox News told us crime is up."))
        // A card followed by its expiry date is still a card.
        assertEquals(setOf(PiiKind.CARD), hits("Did card fees rise for 4111?", "My card is 4111 1111 1111 1111 05 27."))
        assertEquals(setOf(PiiKind.CARD), hits("Was the charge on my card ending 4444 refunded?", "Expiry 05 27 5555 5555 5555 4444 is on my card."))
        assertEquals(setOf(PiiKind.CARD), hits("Was the charge on card 4444 refunded?", "Order 123456 5555-5555-5555-4444 was charged twice."))
        assertEquals(setOf(PiiKind.CARD), hits("Was the charge on my card ending 4444 refunded?", "My card is 5555 5555 5555 4444 123 05 2027."))
        assertEquals(setOf(PiiKind.CARD), hits("Was the charge on card 4444 refunded?", "Card 5555555555554444 was charged twice."))
        assertEquals(emptySet<PiiKind>(), hits("Did prices rise in 2016 2017 2018 2019 2020?", "Prices rose for five years."))
        assertEquals(emptySet<PiiKind>(), hits("Did Zimbabwe print a 100000000000000 dollar note?", "Zimbabwe printed huge notes."))
        assertEquals(emptySet<PiiKind>(), hits("Is Avogadro's number 602214076000000000000000?", "Avogadro's number is huge."))
        assertEquals(emptySet<PiiKind>(), hits("Is pi 3.14159265358979323846?", "Pi has many digits."))
        assertEquals(setOf(PiiKind.ADDRESS), hits("Did rent at 42 Maple street rise?", "Rent at 42 Maple street rose."))
        // A friend's name inside the region's name is still a name.
        assertEquals(setOf(PiiKind.NAME), PiiPostScrubber.findIn("Did Ann get the refund?", "My friend Ann got the refund.", listOf("Annapolis, Maryland")))
    }

    @Test
    fun aPublicHyphenatedPlaceInAnEmailIsNotAName() {
        val hits = PiiPostScrubber.findIn(
            "Did Wilkes-Barre raise parking fees?",
            "Email ana.wilkes-barre@example.com about fees.",
            listOf("Wilkes-Barre"),
        )
        assertEquals(emptySet<PiiKind>(), hits)
    }

    @Test
    fun gatekeeperParserTakesTheFirstBalancedObject() {
        val r = GatekeeperParser.parse("{\"claim\": true, \"query\": \"Is {x} a set?\"} and {\"claim\": false}")
        assertEquals("Is {x} a set?", r!!.sanitizedResolvedQuery)
        assertNull(GatekeeperParser.parse("{\"claim\": true, \"query\": \"open"))
    }

    @Test
    fun scrubberFindsPersonalDataLeftInTheQuery() {
        fun hits(query: String, utterance: String, public: List<String> = emptyList()) =
            PiiPostScrubber.findIn(query, utterance, public)

        assertEquals(setOf(PiiKind.PHONE, PiiKind.NAME), hits("Call Mark at 555-0134 about bus fares?", "Call Mark at 555-0134 about the bus fare numbers."))
        // The address itself, and the name in it.
        assertEquals(setOf(PiiKind.EMAIL, PiiKind.NAME), hits("Is the EV credit still 7,500? sam.rivera@example.com", "Email me at sam.rivera@example.com if the EV credit is still 7,500."))
        assertEquals(setOf(PiiKind.CARD), hits("Did the bridge toll rise for card 4111?", "My card 4111 1111 1111 1111 got charged the new toll rate on the bridge."))
        assertEquals(setOf(PiiKind.SSN), hits("Is identity theft up for 123-45-6789?", "My SSN is 123-45-6789, is the identity theft rate really up this year?"))
        assertEquals(setOf(PiiKind.IBAN), hits("New bank fee on DE89 3704 0044 0532 0130 00?", "Tell Priya her account DE89 3704 0044 0532 0130 00 was charged the new bank fee."))
        assertEquals(setOf(PiiKind.ADDRESS), hits("Did 44 Oak Lane see flu cases double?", "The clinic at 44 Oak Lane says flu cases here doubled last month."))
        assertEquals(setOf(PiiKind.NAME), hits("Did Dr. Patel report flu cases doubling?", "Dr. Patel says flu cases here doubled last month."))
        assertEquals(setOf(PiiKind.NAME), hits("Did Liu report a property tax rise?", "Jenna Liu told me the property tax at 12 Elm Street went up 8 percent."))
        assertEquals(setOf(PiiKind.NAME), hits("Did Kevin O'Brien say revenue grew?", "Kevin O'Brien from accounting said the company's revenue grew 40 percent."))
    }

    @Test
    fun scrubberPassesCleanQueries() {
        fun hits(query: String, utterance: String, public: List<String> = emptyList()) =
            PiiPostScrubber.findIn(query, utterance, public)

        assertTrue(hits("Did Springfield property tax rise 8 percent in 2026?", "Jenna Liu told me the property tax at 12 Elm Street went up 8 percent.").isEmpty())
        assertTrue(hits("Did Acme Robotics revenue grow 40 percent?", "Kevin O'Brien from accounting said the company's revenue grew 40 percent.", listOf("Q4 Engineering at Acme Robotics")).isEmpty())
        assertTrue(hits("Did Nvidia's stock double since January 2026?", "Their stock doubled since January.").isEmpty())
        assertTrue(hits("Did Acme Robotics say revenue grew?", "Acme Robotics said revenue grew.", listOf("Acme Robotics")).isEmpty())
        assertTrue(hits("Was the US population 340,000,000 in 2025?", "The US has 340,000,000 people.").isEmpty())
        assertTrue(hits("Is the speed of light 299,792 km/s?", "Light is 299,792 km/s.").isEmpty())
        assertTrue(hits("Did inflation fall in 2019-2020?", "Inflation fell in 2019-2020.").isEmpty())
    }

    @Test
    fun luhnAcceptsOnlyValidCardNumbers() {
        assertTrue(PiiPostScrubber.luhn("4111 1111 1111 1111"))
        assertFalse(PiiPostScrubber.luhn("4111 1111 1111 1112"))
        assertFalse(PiiPostScrubber.luhn("1234"))
    }

    @Test
    fun gatekeeperParserReadsFencedAndAliasedJson() {
        val r = GatekeeperParser.parse(
            "Here you go:\n```json\n{\"claim\": true, \"query\": \"  Did Springfield raise\n bus fares in October 2026? \", \"refs\": [\"here -> Springfield\", \"\"], \"reason\": \"\"}\n```",
        )
        assertEquals(GatekeeperResult(true, "Did Springfield raise bus fares in October 2026?", listOf("here -> Springfield"), null), r)

        val spec = GatekeeperParser.parse("{\"hasVerifiableClaim\": \"false\", \"sanitizedResolvedQuery\": \"x\", \"filterReason\": \"small talk\"}")
        assertEquals(GatekeeperResult(false, "", emptyList(), "small talk"), spec)
    }

    @Test
    fun gatekeeperParserRejectsInvalidReplies() {
        assertNull(GatekeeperParser.parse(null))
        assertNull(GatekeeperParser.parse("I think this is a claim."))
        assertNull(GatekeeperParser.parse("{\"claim\": true, \"query\": \"  \"}"))
        assertNull(GatekeeperParser.parse("{\"query\": \"no flag\"}"))
        assertNull(GatekeeperParser.parse("{\"claim\": maybe}"))
        val long = GatekeeperParser.parse("{\"claim\": true, \"query\": \"${"a".repeat(500)}\"}")
        assertEquals(GatekeeperParser.QUERY_MAX, long!!.sanitizedResolvedQuery.length)
    }

    private val source = Citation("Example News", "https://example.com/a", "example.com")

    @Test
    fun verdictComesFromTheModelOnlyWithSources() {
        val text = "**VERDICT:** FALSE\nSUMMARY: Harvard was founded in 1636 [1]. The U.S. Senate did not vote on it [2, 3]. A third sentence."
        val grounded = VerdictRules.card(ModelReply(text, "IN_CLOUD", Grounding(listOf(source), listOf("harvard founded"), null)), "m", 800)
        assertEquals(Verdict.FALSE, grounded.verdict)
        assertEquals("Harvard was founded in 1636. The U.S. Senate did not vote on it.", grounded.summary)

        val ungrounded = VerdictRules.card(ModelReply(text, "IN_CLOUD", null), "m", 800)
        assertEquals(Verdict.INSUFFICIENT_EVIDENCE, ungrounded.verdict)
        assertEquals(Verdict.FALSE, ungrounded.modelVerdict)
    }

    @Test
    fun verdictParsingIsTolerant() {
        assertEquals(Verdict.INSUFFICIENT_EVIDENCE, VerdictRules.parseVerdict("Verdict: insufficient evidence\nSummary: none."))
        assertEquals(Verdict.NUANCED, VerdictRules.parseVerdict("VERDICT: NUANCED."))
        assertEquals(Verdict.VERIFIED, VerdictRules.parseVerdict("verdict - verified"))
        assertNull(VerdictRules.parseVerdict("It is probably true."))
        assertNull(VerdictRules.parseVerdict("VERDICT: MOSTLY TRUE"))
        assertEquals("It is probably true.", VerdictRules.parseSummary("It is probably true."))
        val noVerdict = VerdictRules.card(ModelReply("Some text.", "IN_CLOUD", Grounding(listOf(source), emptyList(), null)), "m", 1)
        assertEquals(Verdict.INSUFFICIENT_EVIDENCE, noVerdict.verdict)
    }

    @Test
    fun ledgerTotalsSeparateRawTextFromCleanQueries() {
        val ledger = EgressLedger(capacity = 3)
        fun entry(kind: EgressKind, text: String, source: String?) =
            EgressEntry(1L, kind, "s", "m", text, EgressLedger.bytesOf(text), source, 5, "v1", "ok")
        ledger.add(entry(EgressKind.CLEAN_QUERY, "Is it true?", "IN_CLOUD"))
        ledger.add(entry(EgressKind.CLEAN_QUERY, "Failed é", null))
        ledger.add(entry(EgressKind.RAW_TEXT, "raw", "IN_CLOUD"))
        val t = ledger.entries.value.totals()
        assertEquals(EgressTotals(rawBytes = 3, cleanBytes = 11 + 9, cloudChecks = 1), t)
        assertTrue(ledger.export().contains("Is it true?"))
        ledger.add(entry(EgressKind.RAW_TEXT, "x", null))
        assertEquals(3, ledger.entries.value.size)
        ledger.clear()
        assertTrue(ledger.entries.value.isEmpty())
    }

    @Test
    fun dateHintsNameMonthsAndYears() {
        val today = LocalDate.of(2026, 11, 14)
        assertEquals("Date hint: \"last month\" = October 2026", dateHint("They raised it here last month.", today))
        assertEquals("Date hint: \"last year\" = 2025", dateHint("This company had layoffs last year.", today))
        assertEquals("Date hint: none", dateHint("Water boils at 100 degrees.", today))
        assertEquals("2026-11-09 to 2026-11-15", describeRange(LocalDate.of(2026, 11, 9), LocalDate.of(2026, 11, 15)))
    }

    @Test
    fun promptAssetsHaveTheirPlaceholders() {
        val dir = File("src/main/assets/prompts")
        val gate = dir.resolve("gatekeeper.v1.txt").readText()
        listOf("{{context}}", "{{hints}}", "{{utterance}}").forEach { assertTrue(it, gate.contains(it)) }
        val verify = dir.resolve("verifier.v1.txt").readText()
        assertTrue(verify.contains("{{query}}"))
        val filled = Prompt("v1", verify).fill(mapOf("query" to "Q?"))
        assertFalse(filled.contains("{{"))
        assertNotNull(Regex("VERDICT").find(filled))
    }
}

import { describe, expect, it } from "vitest";
import { PiiPostScrubber, mapDigitsSpaces, type PiiKind } from "./piiPostScrubber";

const kinds = (...k: PiiKind[]) => new Set<PiiKind>(k);
const none = kinds();

describe("PiiPostScrubber", () => {
  it("catches spoken forms and earlier sentences", () => {
    const hits = (query: string, utterance: string, earlier: string[] = []) => PiiPostScrubber.findIn(query, utterance, [], earlier);
    const cases: [string, string, Set<PiiKind>, string[]?][] = [
      ["Did fares rise? 5550001111", "Fares rose, call 5550001111.", kinds("PHONE")],
      ["Is fraud up for 123 45 6789?", "Fraud is up.", kinds("SSN")],
      ["Did rent at 12 elm street rise?", "Rent at 12 elm street rose.", kinds("ADDRESS")],
      ["Did Jenna get the tax refund?", "My friend Jenna got the tax refund.", kinds("NAME")],
      // A possessive after a family title, and the name inside an email address.
      ["Did Rosa's house lose value after the zoning law?", "Aunt Rosa's house lost value.", kinds("NAME")],
      ["Is Sam Rivera's EV credit still 7,500?", "Email sam.rivera@example.com if the EV credit is still 7,500.", kinds("NAME")],
      // A generic mailbox names nobody.
      ["Is Support for the EV credit ending?", "Write to support@example.com about the EV credit.", none],
      ["Did the City Council raise bus fares?", "Write to city.council@example.org about the bus fares.", none],
      ["Did the Springfield Library cut its hours?", "Ask springfield.library@example.org about the hours.", none],
      ["Did the Board of Education cut hours?", "Write to board.education@example.org about hours.", none],
      // Real first.last addresses, including surnames that are also common words, tags and initials.
      ["Did Taylor Hall's bus fare rise?", "Email taylor.hall@example.com if fares rose.", kinds("NAME")],
      ["Is Sam Rivera's EV credit still 7,500?", "Email sam.rivera+fares@example.com about the EV credit.", kinds("NAME")],
      ["Did Rivera get the refund?", "Email j.rivera@example.com about the refund.", kinds("NAME")],
      ["Did Taylor get the refund?", "Email taylor.post@example.com about the refund.", kinds("NAME")],
      // Spelling from an email is unknown, so case, apostrophes and hyphens don't matter; digits and long names too.
      ["Did McDonald get the refund?", "Email j.mcdonald@example.com about the refund.", kinds("NAME")],
      ["Did O'Brien get the refund?", "Email j.obrien@example.com about the refund.", kinds("NAME")],
      ["Did Rivera get the refund?", "Email sam.rivera92@example.com about the refund.", kinds("NAME")],
      ["Did Kim get the refund?", "Email kim.sales@example.com about the refund.", kinds("NAME")],
      ["Did Maria get the refund?", "Email maria.de.la.cruz@example.com about the refund.", kinds("NAME")],
      ["Did LA raise bus fares?", "Email maria.de.la.cruz@example.com about the fares.", none],
      ["Did the Parks Department close the pool?", "Write to parks.department@example.org about the pool.", none],
      ["Did Town Hall extend its hours?", "Write to town.hall@example.org about hours.", none],
      // Possessives, hyphenated names, accents and surnames that are also mailbox-like words.
      ["Did Rivera's refund arrive?", "Email j.rivera@example.com about the refund.", kinds("NAME")],
      ["Did Smith-Jones get the refund?", "Email a.smith-jones@example.com about the refund.", kinds("NAME")],
      ["Did Mary-Jane get the refund?", "Email mary-jane.smith@example.com about the refund.", kinds("NAME")],
      ["Did García get the refund?", "Email jose.garcia@example.com about the refund.", kinds("NAME")],
      ["Did Jordan Parks get the refund?", "Email parks.jordan@example.com about the refund.", kinds("NAME")],
      // Role mailboxes name nobody.
      ["Did retail sales rise this year?", "Email sales@example.com about the sales figures.", none],
      ["Are there no new toll rules?", "I got mail from no-reply@example.org about toll rules.", none],
      ["Did the jobs report beat expectations?", "I emailed jobs@example.com about the opening.", none],
      ["Did AWS raise prices?", "I got an email from no-reply-aws@example.com about price changes.", none],
      ["Are payments delayed?", "Mail from payments-noreply@example.com says payments are delayed.", none],
      ["Did the billing rules change?", "Mail came from do_not_reply.billing@example.com about the billing rules.", none],
      ["Did city parks and recreation cut hours?", "Write to parks.recreation@example.org about hours.", none],
      // Surnames that look like reply words still name someone.
      ["Did Minh get the refund?", "Email do.minh@example.com about the refund.", kinds("NAME")],
      ["Did Kevin O’Brien say revenue grew?", "Kevin O'Brien from accounting said revenue grew.", kinds("NAME")],
      // The gatekeeper resolved "she" from an earlier sentence.
      ["Did the clinic Jenna Liu mentioned close in October 2026?", "She said it closed last month.", kinds("NAME"), ["Jenna Liu told me the clinic is closing."]],
      ["Is 555-0134 a scam number?", "Is that number a scam?", kinds("PHONE"), ["They called from 555-0134."]],
      // Organizations and capitalized sentence starts are not names.
      ["Did the Fed raise rates in 2026?", "The Fed said rates rose.", none],
      ["Is the US population about 340 million?", "The US has about 340 million people.", none],
      ["Did the Federal Reserve raise rates in 2026?", "Rates went up.", none, ["The World Bank said growth slowed.", "Prime Minister Carney said so too."]],
      ["Did flights to New York from Boston double?", "Flights to New York from Boston doubled.", none],
      // Quantities, years and streets in a question are not addresses or phone numbers.
      ["Did 40 people block the street?", "Forty people blocked the street.", none],
      ["Did the 2008 Wall Street crash erase 10 trillion dollars?", "The crash erased trillions.", none],
      ["Did Houston reach 2300000 people?", "Houston has 2300000 people.", none],
      ["Did 500-1000 people attend?", "Hundreds attended.", none],
      ["Did Springfield raise fares in 2026?", "Fares rose this year.", none, ["They called from 555-2026."]],
      ["Did the S&P 500 gain 23 percent in 2024?", "The S&P 500 2024 gain was 23 percent.", none],
      ["Does the prime minister live at 10 Downing Street?", "The prime minister lives at 10 Downing Street.", none],
      ["Did 500 protesters occupy Wall Street in 2011?", "Protesters occupied Wall Street.", none],
      ["Did Bernie Sanders say drug prices doubled?", "Bernie Sanders from the Senate floor said drug prices doubled.", none],
      ["Is crime up, as Fox News reported?", "Fox News told us crime is up.", none],
      // A card followed by its expiry date is still a card.
      ["Did card fees rise for 4111?", "My card is 4111 1111 1111 1111 05 27.", kinds("CARD")],
      ["Was the charge on my card ending 4444 refunded?", "Expiry 05 27 5555 5555 5555 4444 is on my card.", kinds("CARD")],
      ["Was the charge on card 4444 refunded?", "Order 123456 5555-5555-5555-4444 was charged twice.", kinds("CARD")],
      ["Was the charge on my card ending 4444 refunded?", "My card is 5555 5555 5555 4444 123 05 2027.", kinds("CARD")],
      ["Was the charge on card 4444 refunded?", "Card 5555555555554444 was charged twice.", kinds("CARD")],
      ["Did prices rise in 2016 2017 2018 2019 2020?", "Prices rose for five years.", none],
      ["Did Zimbabwe print a 100000000000000 dollar note?", "Zimbabwe printed huge notes.", none],
      ["Is Avogadro's number 602214076000000000000000?", "Avogadro's number is huge.", none],
      ["Is pi 3.14159265358979323846?", "Pi has many digits.", none],
      ["Did rent at 42 Maple street rise?", "Rent at 42 Maple street rose.", kinds("ADDRESS")],
    ];
    for (const [query, utterance, expected, earlier] of cases) {
      expect(hits(query, utterance, earlier), query).toEqual(expected);
    }
    // A friend's name inside the region's name is still a name.
    expect(PiiPostScrubber.findIn("Did Ann get the refund?", "My friend Ann got the refund.", ["Annapolis, Maryland"])).toEqual(kinds("NAME"));
  });

  it("does not take a public hyphenated place in an email for a name", () => {
    const hits = PiiPostScrubber.findIn("Did Wilkes-Barre raise parking fees?", "Email ana.wilkes-barre@example.com about fees.", ["Wilkes-Barre"]);
    expect(hits).toEqual(none);
  });

  it("finds personal data left in the query", () => {
    const hits = (query: string, utterance: string, pub: string[] = []) => PiiPostScrubber.findIn(query, utterance, pub);
    expect(hits("Call Mark at 555-0134 about bus fares?", "Call Mark at 555-0134 about the bus fare numbers.")).toEqual(kinds("PHONE", "NAME"));
    // The address itself, and the name in it.
    expect(hits("Is the EV credit still 7,500? sam.rivera@example.com", "Email me at sam.rivera@example.com if the EV credit is still 7,500.")).toEqual(
      kinds("EMAIL", "NAME"),
    );
    expect(hits("Did the bridge toll rise for card 4111?", "My card 4111 1111 1111 1111 got charged the new toll rate on the bridge.")).toEqual(kinds("CARD"));
    expect(hits("Is identity theft up for 123-45-6789?", "My SSN is 123-45-6789, is the identity theft rate really up this year?")).toEqual(kinds("SSN"));
    expect(hits("New bank fee on DE89 3704 0044 0532 0130 00?", "Tell Priya her account DE89 3704 0044 0532 0130 00 was charged the new bank fee.")).toEqual(
      kinds("IBAN"),
    );
    expect(hits("Did 44 Oak Lane see flu cases double?", "The clinic at 44 Oak Lane says flu cases here doubled last month.")).toEqual(kinds("ADDRESS"));
    expect(hits("Did Dr. Patel report flu cases doubling?", "Dr. Patel says flu cases here doubled last month.")).toEqual(kinds("NAME"));
    expect(hits("Did Liu report a property tax rise?", "Jenna Liu told me the property tax at 12 Elm Street went up 8 percent.")).toEqual(kinds("NAME"));
    expect(hits("Did Kevin O'Brien say revenue grew?", "Kevin O'Brien from accounting said the company's revenue grew 40 percent.")).toEqual(kinds("NAME"));
  });

  it("passes clean queries", () => {
    const hits = (query: string, utterance: string, pub: string[] = []) => PiiPostScrubber.findIn(query, utterance, pub);
    expect(hits("Did Springfield property tax rise 8 percent in 2026?", "Jenna Liu told me the property tax at 12 Elm Street went up 8 percent.")).toEqual(none);
    expect(
      hits("Did Acme Robotics revenue grow 40 percent?", "Kevin O'Brien from accounting said the company's revenue grew 40 percent.", ["Q4 Engineering at Acme Robotics"]),
    ).toEqual(none);
    expect(hits("Did Nvidia's stock double since January 2026?", "Their stock doubled since January.")).toEqual(none);
    expect(hits("Did Acme Robotics say revenue grew?", "Acme Robotics said revenue grew.", ["Acme Robotics"])).toEqual(none);
    expect(hits("Was the US population 340,000,000 in 2025?", "The US has 340,000,000 people.")).toEqual(none);
    expect(hits("Is the speed of light 299,792 km/s?", "Light is 299,792 km/s.")).toEqual(none);
    expect(hits("Did inflation fall in 2019-2020?", "Inflation fell in 2019-2020.")).toEqual(none);
  });

  it("accepts only valid card numbers in the Luhn check", () => {
    expect(PiiPostScrubber.luhn("4111 1111 1111 1111")).toBe(true);
    expect(PiiPostScrubber.luhn("4111 1111 1111 1112")).toBe(false);
    expect(PiiPostScrubber.luhn("1234")).toBe(false);
  });

  it("uses JVM word boundaries and case rules", () => {
    // "the" only stops a street name as a whole word, in any case
    expect(PiiPostScrubber.findIn("Did rent at 12 Theater Street rise?", "Rent rose.")).toEqual(kinds("ADDRESS"));
    expect(PiiPostScrubber.findIn("Did 12 THE Street flood?", "It flooded.")).toEqual(none);
    // a name next to a letter in another script is part of a longer word
    expect(PiiPostScrubber.findIn("Did Jennaé win?", "My friend Jenna won.")).toEqual(none);
    expect(PiiPostScrubber.names("My NEIGHBOUR Jenna and Dr. Rosa's dog")).toEqual(new Set(["Jenna", "Rosa"]));
  });

  it("catches full-width digits and no-break spaces, as Android's ICU regex does", () => {
    // made-up 555 number written with full-width digits
    expect(PiiPostScrubber.findIn("Is \uFF15\uFF15\uFF15-\uFF11\uFF12\uFF13-\uFF14\uFF15\uFF16\uFF17 a scam?", "").size).toBeGreaterThan(0);
    // a name introduced with a no-break space after the title
    expect(PiiPostScrubber.findIn("Did Patel say flu doubled?", "Ask Dr.\u00a0Patel about the flu").has("NAME" as PiiKind)).toBe(true);
  });

  it("catches digits of other scripts and Unicode line separators", () => {
    // made-up 555 number in Arabic-Indic digits
    const arabic = "whose number is \u0665\u0665\u0665-\u0661\u0662\u0663-\u0664\u0665\u0666\u0667";
    expect(PiiPostScrubber.findIn(arabic, arabic).size).toBeGreaterThan(0);
    const address = "who lives at 12\u2028Elm Street";
    expect(PiiPostScrubber.findIn(address, address).size).toBeGreaterThan(0);
  });

  it("catches a name typed with a combining accent after a no-break space", () => {
    // made-up name; "e" + U+0301, as some keyboards type it
    const said = "Mr.\u00a0Rene\u0301 Dubois called about the tax";
    expect(PiiPostScrubber.findIn("What did Rene say about the tax", said).has("NAME" as PiiKind)).toBe(true);
  });

  it("reads a year or round number in other digits as a phone or house number, as Android does", () => {
    // made-up 555 numbers and a Springfield-style street; ICU's literal "20" and "000" are ASCII only
    for (const digits of [["\u0662\u0660\u0660\u0660", "\u0662\u0660\u0661\u0669"], ["\uFF12\uFF10\uFF10\uFF10", "\uFF12\uFF10\uFF11\uFF19"]]) {
      for (const d of digits) {
        const phone = `Is 555-${d} her number?`;
        expect(PiiPostScrubber.findIn(phone, phone)).toEqual(kinds("PHONE"));
      }
      const address = `Is ${digits[1]} Maple Street nice?`;
      expect(PiiPostScrubber.findIn(address, address)).toEqual(kinds("ADDRESS"));
    }
    // ASCII years and round numbers stay quantities
    expect(PiiPostScrubber.findIn("Is 555-2019 her number?", "Is 555-2019 her number?")).toEqual(none);
    expect(PiiPostScrubber.findIn("Is 2019 Maple Street nice?", "Is 2019 Maple Street nice?")).toEqual(none);
  });

  it("checks Luhn on digit code points as Kotlin's c - '0' does", () => {
    // made-up test numbers: Arabic-Indic digits weigh code point minus 48
    expect(PiiPostScrubber.luhn("\u0664" + "\u0661".repeat(14) + "\u0667")).toBe(true);
    expect(PiiPostScrubber.luhn("\u0664" + "\u0661".repeat(15))).toBe(false);
    expect(PiiPostScrubber.luhn("4111111111111111")).toBe(true);
  });

  it("gives every script's digits their value, math digits included", () => {
    expect(mapDigitsSpaces("\u0665\u0966\u{1D7D7}\u{1D7FF}")).toBe("5099");
  });

  it("finds numbers after a stray combining mark, as ICU's word boundary does", () => {
    // made-up test card and SSN numbers
    const card = "card \u03014111 1111 1111 1111 ok";
    expect(PiiPostScrubber.findIn(card, card).size).toBeGreaterThan(0);
    const ssn = "ssn \u0301123-45-6789 ok";
    expect(PiiPostScrubber.findIn(ssn, ssn).size).toBeGreaterThan(0);
  });

  it("does not treat a name as public because of a connector character in a public name", () => {
    // "Rosa‿Cup" is one word for ICU, so "Rosa" alone is not public there either
    expect(PiiPostScrubber.findIn("Did Rosa win?", "my friend Rosa won", ["Rosa\u203FCup"]).has("NAME" as PiiKind)).toBe(true);
  });

  it("folds ß and the long s in relation words, as ICU does", () => {
    expect(PiiPostScrubber.findIn("Is Jenna ok?", "my bo\u00DF Jenna called").has("NAME" as PiiKind)).toBe(true);
    expect(PiiPostScrubber.findIn("Is Jenna\u00B2 ok?", "my \u017Fister Jenna called").has("NAME" as PiiKind)).toBe(true);
  });
});

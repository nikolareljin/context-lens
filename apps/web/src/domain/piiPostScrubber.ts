import { B, D, S, ci, escape, ktTrim, re } from "./jvmRegex";

export type PiiKind = "EMAIL" | "PHONE" | "CARD" | "IBAN" | "SSN" | "ADDRESS" | "NAME";

/**
 * The deterministic check after the gatekeeper. A hit blocks the cloud call; the
 * query is never repaired and sent anyway. It looks for personal data in the query
 * itself, and for personal data found in the original sentence that the query
 * still carries. Results name only the kind, never the matched text.
 */

const email = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gu;
const ssn = re(`${B}${D}{3}([ -])${D}{2}\\1${D}{4}${B}`, "g");
/** A whole run of digits, not the decimals of a number ("3.14159265358979"); cardWindows finds the card inside it. */
const card = re(`(?<!${D}[.,])${B}(?:${D}[ -]?){12,40}${D}${B}`, "g");
const iban = re(`${B}[A-Z]{2}${D}{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?${B}`, "g");
/**
 * North American numbers with separators, and any "+" number of 7 to 15 digits. The
 * short form takes "-" or "." only and no year after it ("Fortune 500 2024", "737-2018").
 * A range like "200-1500" still matches; it can't be told apart from "555-1500".
 */
const phone = re(
  `\\+${D}(?:[ .-]?${D}){6,14}${B}` +
    `|(?:\\(${D}{3}\\)|${B}${D}{3})[ .-]?${D}{3}[ .-]${D}{4}${B}` +
    `|${B}${D}{3}[.-](?!(?:1[89]|20)${D}${D}${B})${D}{4}${B}`,
  "g",
);

/**
 * 7 or 10 digits without separators, as speech recognizers often write a phone
 * number. Only looked for in the sentences, never in the query alone: in a question
 * a bare number is far more often a quantity ("2300000 people").
 */
const barePhone = re(`${B}${D}{10}${B}|${B}${D}{7}${B}`, "g");

/**
 * Kotlin filter(Char::isDigit): the decimal digits of any script, one UTF-16 unit at a
 * time (a digit outside the Basic Multilingual Plane is two units, neither a digit).
 */
const digitsOf = (text: string) => Array.from({ length: text.length }, (_, i) => text[i]).filter((c) => ND.test(c)).join("");

/** A round number ("500-1000", "8000000") is a quantity, not a phone number. */
const roundNumber = (text: string) => digitsOf(text).endsWith("000");

/** A house number: not a year ("the 2008 Wall Street crash"), and never Wall Street itself. */
const HOUSE = `${B}(?!(?:1[89]|20)${D}${D}${B})${D}{1,5}${S}+(?!Wall${S}+Street${B})`;

/** A street-name word: not an article or preposition ("40 people block the street"). */
const STREET_WORD = `(?!(?:${ci("the|a|an|on|in|at|of|to|and|or|for|from|by|with|into|down|up|along|across")})${B})`;

/** Capitalized street names with any street type, or one word before a lower-case or unambiguous type ("12 elm street", "42 Maple street"). */
const addresses = [
  re(
    `${HOUSE}(?:${STREET_WORD}[A-Z][a-z]+${S}+){1,3}` +
      `(?:Street|St|Lane|Ln|Avenue|Ave|Road|Rd|Court|Ct|Drive|Dr|Boulevard|Blvd|Way|Place|Pl|Terrace|Circle)${B}`,
    "g",
  ),
  re(`${HOUSE}${STREET_WORD}[A-Za-z][a-z]+${S}+(?:${ci("street|avenue|boulevard")})${B}`, "g"),
];

/** Public addresses that fact checks name ("10 Downing Street"). */
const publicAddresses = re(`${B}(?:${ci("Wall Street|Downing Street|Pennsylvania Avenue")})${B}`);

const NAME = "[A-Z][a-z]+(?:['’-][A-Z]?[a-z]+)?";
const PROPER = "[A-Z][A-Za-z]*(?:['’-][A-Z]?[a-z]+)?";

/**
 * A person named in the sentence: by title, by address form, after "my friend" and
 * the like, or as First Last before a personal verb ("Jenna Liu told me") or a
 * workplace ("Kevin O'Brien from accounting"). Public speech verbs ("said", "says")
 * are not used: "The World Bank said" and "Prime Minister Carney said" are not
 * private people, and the gatekeeper prompt already asks for private names to be
 * left out.
 */
const namePatterns = [
  re(`${B}(?:Dr|Mr|Mrs|Ms|Mx|Prof|Aunt|Uncle|Grandma|Grandpa)\\.?${S}+(${NAME})`, "g"),
  re(`^(?:Call|Tell|Text|Email|Ask|Message|Ping|Remind)${S}+(${NAME})`, "g"),
  re(
    `${B}(?:${ci("my|our|his|her|their|your")})${S}+(?:${ci(
      "friend|wife|husband|partner|boss|neighbou?r|colleague|coworker|" +
        "brother|sister|mom|mother|dad|father|son|daughter|cousin|doctor|landlord|teacher",
    )})${S}+(${NAME})`,
    "g",
  ),
  re(`${B}(${NAME}${S}+${PROPER})${S}+(?:told (?:me|us)|asked (?:me|us)|texted|called (?:me|us)|mentioned (?:to )?(?:me|us))${B}`, "g"),
  re(`${B}(${NAME}${S}+${PROPER})${S}+from${S}+(?!(?:the|a|an|his|her|their|our|my|its)${B})(?=[a-z])`, "g"),
];

/** Capitalized words that never begin a name ("The Fed said…"). */
const notNames = new Set(["The", "A", "An", "My", "Our", "Your", "His", "Her", "Their", "This", "That", "These", "Those"]);

/** Words that make a capitalized pair an organization, not a person ("Fox News told us"). */
const orgWords = new Set([
  "News", "Times", "Post", "Journal", "Press", "Media", "Bank", "Reserve", "Fed", "Council", "Department",
  "Ministry", "University", "College", "Institute", "Party", "Senate", "House", "Court", "Agency", "Office",
  "Group", "Inc", "Corp", "Company", "Foundation", "Association", "Union", "Committee", "Commission",
]);

const numeric = new Set<PiiKind>(["PHONE", "CARD", "IBAN", "SSN"]);

type Hit = [PiiKind, string];

/** An inclusive character range, like Kotlin IntRange. */
type Range = [number, number];

const overlaps = (a: Range, b: Range) => a[0] <= b[1] && b[0] <= a[1];

const word = (name: string) => re(`${B}${escape(name)}${B}`);

/**
 * The kinds of personal data in query. utterance is the original sentence and
 * earlier the sentences the gatekeeper saw before it (it resolves "she" or "that
 * number" from them); publicNames (pinned topic, region) are never treated as
 * personal names.
 *
 * The patterns read digits and spaces as Android's ICU regex does: \d is a digit of any
 * script ("٢٠١٩", "２０１９"), while the literal digits of a year or a round number are
 * ASCII, so "555-٢٠١٩" is a phone number there and here. The text is then checked again
 * with digits and spaces mapped to ASCII, as written and NFKC-normalized ("５５５" → "555",
 * U+00A0 → space). Any check finding something counts, so the extra checks can only find more.
 */
export function findIn(
  query: string,
  utterance: string,
  publicNames: string[] = [],
  earlier: string[] = [],
): Set<PiiKind> {
  const hits = findInText(query, utterance, publicNames, earlier);
  // Digits and spaces mapped on the raw text (keeps decomposed accents as typed), and
  // the same after NFKC (catches compatibility forms such as "ſ" for "s").
  for (const f of [mapDigitsSpaces, asciiForm]) {
    findInText(f(query), f(utterance), publicNames.map(f), earlier.map(f)).forEach((k) => hits.add(k));
  }
  return hits;
}

const ND = /\p{Nd}/u;
const SPACE = /[\p{Z}\u0085]/u;

/**
 * Every decimal digit of any script as its ASCII digit and every Unicode space or line
 * separator as a space: what ICU's \d and \s match on the phone. Unicode keeps each
 * script's digits as runs of ten starting at zero, so a digit's value is the number of
 * digits right before it, modulo ten.
 */
export function mapDigitsSpaces(text: string): string {
  return Array.from(text, (ch) => {
    if (SPACE.test(ch)) return " ";
    if (ch >= "0" && ch <= "9") return ch;
    if (!ND.test(ch)) return ch;
    const cp = ch.codePointAt(0)!;
    let k = 0;
    while (ND.test(String.fromCodePoint(cp - k - 1))) k++;
    return String(k % 10);
  }).join("");
}

/** NFKC, then [mapDigitsSpaces]. */
export function asciiForm(text: string): string {
  return mapDigitsSpaces(text.normalize("NFKC"));
}

function findInText(
  query: string,
  utterance: string,
  publicNames: string[],
  earlier: string[],
): Set<PiiKind> {
  const hits = new Set<PiiKind>();
  patternHits(query).forEach(([kind]) => hits.add(kind));
  // Personal data from the sentences that survived into the query, even partly
  // (a card's first or last four digits, the end of a phone number). From earlier sentences
  // a part must be 5+ digits, so a phone ending "2026" does not block every question
  // about 2026.
  const sentences = [...earlier, utterance];
  const found: Hit[] = [];
  sentences.forEach((sentence, i) => {
    const minPart = i === sentences.length - 1 ? 4 : 5;
    patternHits(sentence, true).forEach((hit) => {
      found.push(hit);
      const [kind, text] = hit;
      const partial =
        (numeric.has(kind) && Array.from(text.matchAll(re(`${D}{${minPart},}`, "g"))).some((m) => query.includes(m[0]))) ||
        (kind === "CARD" && re(`(?<!${D})${digitsOf(text).slice(-4)}(?!${D})`).test(query));
      if (query.includes(text) || partial) hits.add(kind);
    });
  });
  const publicText = publicNames.join(" ");
  const addressText = found.filter(([kind]) => kind === "ADDRESS").map(([, text]) => text).join(" ");
  const curly = (text: string) => text.replaceAll("’", "'");
  sentences
    .flatMap((s) => [...names(s)])
    .filter((it) => !word(it).test(publicText) && !word(it).test(addressText))
    // "O’Brien" with a curly apostrophe is the same name as "O'Brien".
    .forEach((it) => {
      if (word(curly(it)).test(curly(query))) hits.add("NAME");
    });
  // An email gives a name without its spelling ("j.mcdonald@" for McDonald, "j.obrien@" for O'Brien),
  // so those compare without case, apostrophes or hyphens.
  // Accents are dropped ("García" is "garcia"), a possessive is dropped ("Rivera's"), and a
  // hyphenated name is tried both joined and split ("Smith-Jones": "smithjones", "smith jones").
  const looseQueries = [loose(query, ""), loose(query, " ")];
  const loosePublics = [loose(publicText, ""), loose(publicText, " ")];
  new Set(sentences.flatMap(emailNames).map((it) => loose(it, "")))
    .forEach((name) => {
      if (loosePublics.some((it) => word(name).test(it))) return;
      if (looseQueries.some((it) => word(name).test(it))) hits.add("NAME");
    });
  return hits;
}

const marks = re("\\p{Mn}+", "g");
const possessive = re(`['’]s${B}`, "g");

function loose(text: string, hyphen: string): string {
  return text
    .normalize("NFD")
    .replace(marks, "")
    .toLowerCase()
    .replace(possessive, "")
    .replace(/['’]/g, "")
    .replaceAll("-", hyphen);
}

/** Matches in priority order; a match inside an earlier one (card digits within an IBAN) is skipped. */
function patternHits(text: string, bare = false): Hit[] {
  const taken: Range[] = [];
  const out: Hit[] = [];
  const take = (kind: PiiKind, matches: RegExpMatchArray[]) =>
    matches.forEach((m) => {
      const range: Range = [m.index!, m.index! + m[0].length - 1];
      if (!taken.some((it) => overlaps(it, range))) {
        taken.push(range);
        out.push([kind, m[0]]);
      }
    });
  const all = (pattern: RegExp) => Array.from(text.matchAll(pattern));
  take("EMAIL", all(email));
  take("IBAN", all(iban));
  take("SSN", all(ssn));
  // Every card window that no earlier kind took counts (a CVV and expiry read as an SSN don't hide the card).
  all(card).forEach((m) => {
    const free = cardWindows(m).filter(([range]) => !taken.some((it) => overlaps(it, range)));
    free.forEach(([range, value]) => {
      taken.push(range);
      out.push(["CARD", value]);
    });
  });
  addresses.forEach((r) => take("ADDRESS", all(r).filter((m) => !publicAddresses.test(m[0]))));
  take("PHONE", all(phone).filter((m) => !roundNumber(m[0])));
  if (bare) take("PHONE", all(barePhone).filter((m) => !roundNumber(m[0])));
  return out;
}

/** Single name tokens (first and last names separately). */
export function names(utterance: string): Set<string> {
  const trimmed = ktTrim(utterance);
  return new Set(
    namePatterns
      .flatMap((p) => Array.from(trimmed.matchAll(p), (m) => m[1]))
      .map((it) => it.split(re(`${S}+`)))
      // "The Fed said" is not a First Last.
      .filter((it) => !notNames.has(it[0]) && !it.some((w) => orgWords.has(w)))
      .flat()
      // "Aunt Rosa's house": the name is Rosa.
      .map((it) => removeSuffix(removeSuffix(it, "'s"), "’s"))
      .filter((it) => it.length > 1),
  );
}

function removeSuffix(text: string, suffix: string): string {
  return text.endsWith(suffix) ? text.slice(0, -suffix.length) : text;
}

const trimEndDigits = (text: string) => text.replace(/[0-9]+$/, "");
const isLetters = re("^\\p{L}*$");

/**
 * Names in an email address: "sam.rivera@" gives Sam and Rivera, as do
 * "sam.rivera92@", "sam.rivera+fares@", "maria.de.la.cruz@" (Maria, Cruz) and
 * "a.smith-jones@" (Smith, Jones, and Smithjones for "Smith-Jones"); one-letter
 * initials are dropped. An address that starts with a mailbox word ("info@",
 * "sales@", "city.council@") or ends with an office word ("springfield.library@",
 * "parks.department@") names nobody.
 * Not covered: an address without separators ("jrivera@") gives one word that rarely
 * matches the name in a question; the gatekeeper prompt is the first line there.
 */
export function emailNames(utterance: string): string[] {
  return Array.from(utterance.matchAll(email)).flatMap((m) => {
    const local = m[0].split("@")[0].split("+")[0].toLowerCase();
    const parts = local.split(/[._-]+/).map(trimEndDigits).filter((it) => it.length > 0);
    // Hyphenated parts also as one word: "smith-jones" for "Smith-Jones".
    const joined = local.split(/[._]+/).map(trimEndDigits).filter((it) => it.includes("-")).map((it) => it.replaceAll("-", ""));
    const mailbox =
      parts.length === 0 ||
      // "no-reply@", "no-reply-aws@", "payments-noreply@": a reply word anywhere in the address.
      parts.some((_, i) => parts.some((__, k) => k >= i && replyAddresses.has(parts.slice(i, k + 1).join("")))) ||
      (parts.length === 1 && singleRoles.has(parts[0])) ||
      mailboxStarts.has(parts[0]) ||
      officeEnds.has(parts[parts.length - 1]);
    if (mailbox) return [];
    return [...parts, ...joined].filter((it) => it.length >= 2 && isLetters.test(it) && !particles.has(it));
  });
}

/** Local parts that start a shared mailbox, not a person ("info@", "city.council@"). */
const mailboxStarts = new Set([
  "info", "support", "contact", "admin", "hello", "office", "team", "mail", "noreply", "donotreply",
  "help", "news", "billing", "sales", "press", "media", "careers", "events", "orders", "hr", "city", "town",
  "county", "state", "public", "customer", "service", "services", "school", "police", "fire", "board",
  "parking", "council", "tickets", "returns", "tips", "feedback", "privacy", "legal", "marketing", "accounts",
  "notifications", "alerts", "webmaster", "postmaster", "registrar",
]);

/** "no-reply", "do_not_reply" and the like anywhere in an address, whatever the separators. */
const replyAddresses = new Set(["noreply", "donotreply", "donotrespond", "noresponse", "replies"]);

/** Role words that are also surnames: a mailbox only when they are the whole address ("jobs@", "parks@"). */
const singleRoles = new Set(["jobs", "parks", "recreation", "rates", "fares", "permits", "tolls"]);

/** Local parts that end an office's address ("springfield.library@", "parks.department@"). */
const officeEnds = new Set([
  "library", "council", "department", "dept", "office", "committee", "commission", "agency", "ministry",
  "university", "college", "institute", "foundation", "association", "board", "services", "clerk", "recreation",
]);

/** Surname particles: part of a name, but too common as words to block on ("LA"). */
const particles = new Set([
  "de", "la", "del", "della", "van", "von", "der", "da", "di", "du", "le", "al", "el", "bin", "ibn",
  // Two-letter everyday words that would block almost any question.
  "an", "do", "to", "so", "no", "in", "on", "at", "of", "or", "is", "it", "us", "we", "me", "my", "up",
]);

/**
 * Every 13-19 digit window of m that passes Luhn, so digits before or after a card
 * number (an expiry date, a CVV, an order number) don't hide it. In a run with
 * separators only windows that start and end on digit groups count
 * ("05 27 | 5555 5555 5555 4444"); a run without separators tries every window.
 */
function cardWindows(m: RegExpMatchArray): [Range, string][] {
  const v = m[0];
  const offset = m.index!;
  const digitAt: number[] = [];
  for (let i = 0; i < v.length; i++) if (ND.test(v[i])) digitAt.push(i);
  const last = digitAt.length - 1;
  const isStart = (i: number) => i === 0 || digitAt[i] !== digitAt[i - 1] + 1;
  const isEnd = (i: number) => i === last || digitAt[i + 1] !== digitAt[i] + 1;
  const aligned = digitAt.length !== v.length;
  const out: [Range, string][] = [];
  digitAt.forEach((_, first) => {
    if (aligned && !isStart(first)) return;
    for (let count = 13; count <= 19; count++) {
      const end = first + count - 1;
      if (end > last || (aligned && !isEnd(end))) continue;
      const from = digitAt[first];
      const value = v.substring(from, digitAt[end] + 1);
      if (luhn(value) && cardShaped(value)) out.push([[offset + from, offset + from + value.length - 1], value]);
    }
  });
  return out;
}

const yearLike = re(`^(?:1[89]|20)${D}${D}$`);

/**
 * Card numbers start with 2-6 (Mastercard, Amex, Visa, Discover and the like). A list
 * of years ("2017 2018 2019 2020") or a written-out round number ("100000000000000",
 * whose zero windows pass Luhn) is not a card.
 */
function cardShaped(value: string): boolean {
  const digits = digitsOf(value);
  return digits[0] >= "2" && digits[0] <= "6" && !digits.endsWith("00000") && !value.split(/[ -]/).every((it) => yearLike.test(it));
}

export function luhn(candidate: string): boolean {
  const digits = digitsOf(candidate);
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  [...digits].reverse().forEach((c, i) => {
    let d = c.charCodeAt(0) - 48;
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  });
  return sum % 10 === 0;
}

export const PiiPostScrubber = { findIn, names, emailNames, luhn };

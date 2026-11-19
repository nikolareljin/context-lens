/**
 * Building blocks that give JavaScript regexes the meaning the Android rules have on
 * the JVM, so both apps decide the same way. Every pattern built from these uses the
 * "u" flag.
 *
 * - Whitespace follows the phone, not the JVM unit tests: Android's ICU regex \s matches
 *   Unicode spaces and line separators (no-break space, U+2028) as well as ASCII ones, so a
 *   phrase or a card number split by them is read the same way in both apps.
 * - Word boundaries follow ICU \b as on the phone. Word characters are ICU's \w set:
 *   alphabetic characters (letters, letter numerals such as "Ⅻ", circled letters), marks,
 *   decimal digits, connector punctuation ("_", "‿") and the zero-width joiners. Combining
 *   marks and invisible format characters are looked past, so a stray accent before a
 *   number does not hide it.
 * - Case-insensitive words follow ICU (?i) as on the phone, which uses full case folding:
 *   besides upper and lower case, "ſ" matches "s", the Kelvin sign "k", "ß"/"ẞ" "ss" and the
 *   Latin ligatures their letters ("ﬁ" for "fi"). JavaScript /iu folds only one character to
 *   one, so the words are spelled out instead ([sSſ], (?:ss|ß), ...).
 */

/** Android (ICU) \s: ASCII whitespace, U+0085 and every Unicode space or line separator. */
export const S = "[\\t-\\r\\x85\\p{Z}]";

const WORD = "[\\p{Alphabetic}\\p{M}\\p{Nd}\\p{Pc}\\u200C\\u200D]";
const SKIP = "[\\p{Grapheme_Extend}\\p{Cf}]";
/** A word character that is not looked past: what a boundary is decided on. */
const BASE = `(?:(?!${SKIP})${WORD})`;

/** ICU \b: a boundary between word and non-word characters, looking past combining marks and format characters. */
export const B = `(?!${SKIP})(?:(?<!${BASE}${SKIP}*)(?=${BASE})|(?<=${BASE}${SKIP}*)(?!${BASE}))`;

/** ICU \W: any character that is not a word character. */
export const W = "[^\\p{Alphabetic}\\p{M}\\p{Nd}\\p{Pc}\\u200C\\u200D]";

/** Letters with more than their two cases under ICU full case folding. */
const LETTER: Record<string, string> = { s: "[sS\u017F]", k: "[kK\u212A]" };

/** Letter sequences that ICU (?i) also matches as one character. */
const SEQUENCES: [string, string][] = [
  ["ffi", "\uFB03"],
  ["ffl", "\uFB04"],
  ["ff", "\uFB00"],
  ["fi", "\uFB01"],
  ["fl", "\uFB02"],
  ["ss", "\u00DF\u1E9E"],
  ["st", "\uFB05\uFB06"],
];

const letter = (c: string) => LETTER[c.toLowerCase()] ?? `[${c.toLowerCase()}${c.toUpperCase()}]`;

/**
 * ASCII words matched as ICU (?i) matches them: "the|a" -> "[tT][hH][eE]|[aA]", with
 * "s" also matching "ſ", "ss" also "ß"/"ẞ", "fi" also "ﬁ", and so on. Use outside classes only.
 */
export function ci(words: string): string {
  let out = "";
  let i = 0;
  while (i < words.length) {
    const rest = words.slice(i).toLowerCase();
    const seq = SEQUENCES.find(([s]) => rest.startsWith(s));
    if (seq) {
      const [s, chars] = seq;
      out += `(?:${Array.from(words.slice(i, i + s.length), letter).join("")}|[${chars}])`;
      i += s.length;
      continue;
    }
    const c = words[i];
    out += /[A-Za-z]/.test(c) ? letter(c) : c;
    i += 1;
  }
  return out;
}

export function re(source: string, flags = ""): RegExp {
  return new RegExp(source, `u${flags}`);
}

/** A string matched literally, like Kotlin Regex.escape. */
export function escape(text: string): string {
  return text.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&");
}

/** Kotlin Char.isWhitespace: Java whitespace or a Unicode space separator. */
const KT_WS = "[\\t\\n\\x0B\\f\\r\\x1C-\\x1F\\p{Zs}\\p{Zl}\\p{Zp}]";
const KT_TRIM = re(`^${KT_WS}+|${KT_WS}+$`, "g");
const KT_BLANK = re(`^${KT_WS}*$`);

/** Kotlin String.trim(). */
export function ktTrim(text: string): string {
  return text.replace(KT_TRIM, "");
}

/** Kotlin String.isBlank(). */
export function ktIsBlank(text: string): boolean {
  return KT_BLANK.test(text);
}

/** Kotlin String.lines(): splits on CRLF, LF and CR. */
export function ktLines(text: string): string[] {
  return text.split(/\r\n|\n|\r/);
}

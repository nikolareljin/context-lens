/**
 * Building blocks that give JavaScript regexes the meaning the Android rules have on
 * the JVM, so both apps decide the same way. Every pattern built from these uses the
 * "u" flag.
 *
 * - Whitespace follows the phone, not the JVM unit tests: Android's ICU regex \s matches
 *   Unicode spaces and line separators (no-break space, U+2028) as well as ASCII ones, so a
 *   phrase or a card number split by them is read the same way in both apps.
 * - Word boundaries follow ICU \b as on the phone: letters, digits and "_" in any script
 *   are word characters, and combining marks and invisible format characters are looked
 *   past, so a stray accent before a number does not hide it.
 * - JVM (?i) folds ASCII only; JavaScript /iu folds Unicode ("ſ" matches "s"), so
 *   case-insensitive words are spelled out as [aA] classes instead.
 */

/** Android (ICU) \s: ASCII whitespace, U+0085 and every Unicode space or line separator. */
export const S = "[\\t-\\r\\x85\\p{Z}]";

const WORD = "[\\p{L}\\p{Nd}_]";
const SKIP = "[\\p{Grapheme_Extend}\\p{Cf}]";

/** ICU \b: a boundary between word and non-word characters, looking past combining marks and format characters. */
export const B = `(?!${SKIP})(?:(?<!${WORD}${SKIP}*)(?=${WORD})|(?<=${WORD}${SKIP}*)(?!${WORD}))`;

/** ICU \W: any character that is not a word character. */
export const W = "[^\\p{L}\\p{Nd}_]";

/** ASCII letters matched without case, as JVM (?i) does: "the|a" -> "[tT][hH][eE]|[aA]". */
export function ci(words: string): string {
  return words.replace(/[A-Za-z]/g, (c) => `[${c.toLowerCase()}${c.toUpperCase()}]`);
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

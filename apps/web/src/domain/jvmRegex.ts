/**
 * Building blocks that give JavaScript regexes the meaning the Android rules have on
 * the JVM, so both apps decide the same way. Every pattern built from these uses the
 * "u" flag.
 *
 * - JVM \s is ASCII whitespace only; JavaScript \s also takes no-break and other Unicode spaces.
 * - JVM \b (Java 17) counts letters, digits, "_" and combining marks in any script as word
 *   characters; JavaScript \b only knows ASCII.
 * - JVM (?i) folds ASCII only; JavaScript /iu folds Unicode ("ſ" matches "s"), so
 *   case-insensitive words are spelled out as [aA] classes instead.
 */

/** JVM \s. */
export const S = "[ \\t\\n\\x0B\\f\\r]";

const WORD = "[\\p{L}\\p{Nd}\\p{Mn}_]";

/** JVM \b. */
export const B = `(?:(?<!${WORD})(?=${WORD})|(?<=${WORD})(?!${WORD}))`;

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

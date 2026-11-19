import { B, S, ci, ktIsBlank, ktLines, ktTrim, re } from "./jvmRegex";
import { VERDICTS, type FactCard, type Grounding, type ModelReply, type Verdict } from "./types";

/**
 * Turns the verifier's text into a card. The model proposes; these rules decide:
 * no web source means "insufficient evidence" whatever the model wrote, an
 * unreadable verdict also means "insufficient evidence", and the summary is cut
 * to two sentences.
 */
export const SUMMARY_SENTENCES = 2;

/** Where a JVM multiline ^ matches: the start, or after any line terminator. */
const LINE_START = "(?:^|(?<=[\\n\\r\\u0085\\u2028\\u2029]))";
const VERDICT_BODY = `\\W*${ci("verdict")}\\W*:?${S}*\\**${S}*([A-Za-z_ ]+)`;
const verdictLine = re(`${LINE_START}${VERDICT_BODY}`);
const verdictWholeLine = re(`^(?:${VERDICT_BODY})$`);
const summaryLine = re(`${B}${ci("summary")}\\W*:${S}*([\\s\\S]+)`);
const citationMarks = re(`${S}*\\[(?:\\d+(?:${S}*[,\\-]${S}*\\d+)*)\\]`, "g");
/** JVM $ without multiline: the end, or before a final line terminator. */
const abbreviation = re(
  `(?:${B}[A-Z]|${B}(?:Mr|Mrs|Ms|Dr|St|vs|etc|No|approx|Jan|Feb|Aug|Sept|Oct|Nov|Dec))\\.(?=(?:\\r\\n|[\\n\\r\\u0085\\u2028\\u2029])?$)`,
);
const spaces = re(`${S}+`, "g");
const sentenceBreak = re(`(?<=[.!?])${S}+`);

export function parseVerdict(text: string | null | undefined): Verdict | null {
  if (text == null) return null;
  const group = verdictLine.exec(text)?.[1];
  if (group === undefined) return null;
  const token = ktTrim(group).replaceAll(" ", "_").toUpperCase();
  return VERDICTS.find((it) => token.startsWith(it)) ?? null;
}

export function parseSummary(text: string | null | undefined): string {
  const raw = text == null ? "" : ktTrim(text);
  const body =
    summaryLine.exec(raw)?.[1] ??
    ktLines(raw)
      .filter((it) => !verdictWholeLine.test(it))
      .join(" ");
  const clean = ktTrim(body.replaceAll("**", "").replace(citationMarks, "").replace(spaces, " "));
  return firstSentences(clean, SUMMARY_SENTENCES);
}

export function firstSentences(text: string, max: number): string {
  const sentences: string[] = [];
  for (const part of text.split(sentenceBreak)) {
    const last = sentences.at(-1);
    if (last !== undefined && abbreviation.test(last)) {
      sentences[sentences.length - 1] = `${last} ${part}`;
    } else {
      sentences.push(part);
    }
  }
  return sentences
    .filter((it) => !ktIsBlank(it))
    .slice(0, max)
    .join(" ");
}

export function card(reply: ModelReply, model: string, latencyMs: number): FactCard {
  const grounding: Grounding = reply.grounding ?? { citations: [], searchQueries: [], searchEntryPointHtml: null };
  const proposed = parseVerdict(reply.text);
  const verdict: Verdict = grounding.citations.length === 0 ? "INSUFFICIENT_EVIDENCE" : (proposed ?? "INSUFFICIENT_EVIDENCE");
  return {
    verdict,
    modelVerdict: proposed,
    summary: parseSummary(reply.text),
    grounding,
    model,
    source: reply.source,
    latencyMs,
  };
}

export const VerdictRules = { SUMMARY_SENTENCES, parseVerdict, parseSummary, firstSentences, card };

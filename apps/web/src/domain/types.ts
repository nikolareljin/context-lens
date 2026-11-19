export const VERDICTS = ["VERIFIED", "NUANCED", "FALSE", "INSUFFICIENT_EVIDENCE"] as const;
export type Verdict = (typeof VERDICTS)[number];

/** One web source from the grounding metadata. */
export interface Citation {
  title: string;
  uri: string;
  domain: string;
}

/** What Google Search grounding returned with a reply. */
export interface Grounding {
  citations: Citation[];
  searchQueries: string[];
  /** Google's Search Suggestions chip (HTML), to be shown with grounded results. */
  searchEntryPointHtml: string | null;
}

/** The gatekeeper's answer, after validation. */
export interface GatekeeperResult {
  hasVerifiableClaim: boolean;
  /** Self-contained, without personal data; empty when there is no claim. */
  sanitizedResolvedQuery: string;
  /** e.g. "here -> Springfield". */
  resolvedReferences: string[];
  filterReason: string | null;
}

/** A verdict as shown: the deterministic rules have the last word over the model. */
export interface FactCard {
  verdict: Verdict;
  /** What the model said before the rules ran; null when it gave no readable verdict. */
  modelVerdict: Verdict | null;
  /** At most two sentences. */
  summary: string;
  grounding: Grounding;
  model: string;
  /** As Firebase AI Logic reported it, e.g. IN_CLOUD. */
  source: string | null;
  latencyMs: number;
}

/** A model reply reduced to what the pipeline uses. */
export interface ModelReply {
  text: string | null;
  /** response.inferenceSource, verbatim (ON_DEVICE or IN_CLOUD). */
  source: string | null;
  grounding?: Grounding | null;
}

/** A versioned prompt template; the version goes into every ledger entry. */
export class Prompt {
  constructor(
    readonly version: string,
    readonly template: string,
  ) {}

  /** Replaces each {{key}} in turn, as the Android app does. */
  fill(values: Record<string, string>): string {
    return Object.entries(values).reduce((acc, [key, value]) => acc.split(`{{${key}}}`).join(value), this.template);
  }
}

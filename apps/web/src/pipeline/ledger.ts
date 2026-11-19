export type EgressKind =
  /** The sentence and its context (Balanced mode, when the model ran in the cloud). */
  | "RAW_TEXT"
  /** Only the clean question, sent to the grounded verifier. */
  | "CLEAN_QUERY"
  /** A Firebase setup request (anonymous sign-in, App Check token): no text of the visitor in it. */
  | "SETUP";

/** One request that left the browser, with the exact text that was sent. */
export interface EgressEntry {
  atMillis: number;
  kind: EgressKind;
  stage: string;
  model: string;
  text: string;
  bytes: number;
  /** inferenceSource as reported; null when the call failed before a reply. */
  source: string | null;
  latencyMs: number;
  promptVersion: string;
  outcome: string;
}

const encoder = new TextEncoder();

export function bytesOf(text: string): number {
  return encoder.encode(text).length;
}

/**
 * Every request that left the browser, in memory only, newest first. The totals are
 * computed from it, so "raw text sent: 0 B" is a measurement.
 */
export class EgressLedger {
  private list: EgressEntry[] = [];
  private listeners = new Set<() => void>();

  constructor(private readonly capacity = 200) {}

  get entries(): EgressEntry[] {
    return this.list;
  }

  add(entry: EgressEntry): void {
    this.list = [entry, ...this.list].slice(0, this.capacity);
    this.listeners.forEach((l) => l());
  }

  clear(): void {
    this.list = [];
    this.listeners.forEach((l) => l());
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  export(): string {
    const lines = [`ContextLens egress ledger (${this.list.length} requests)`];
    for (const e of [...this.list].reverse()) {
      lines.push(
        "",
        `${new Date(e.atMillis).toISOString()} ${e.stage} ${e.kind} ${e.model} prompt ${e.promptVersion}`,
        `source ${e.source ?? "none"} · ${e.latencyMs} ms · ${e.bytes} B · ${e.outcome}`,
        e.text,
      );
    }
    return lines.join("\n");
  }
}

export interface EgressTotals {
  rawBytes: number;
  cleanBytes: number;
  cloudChecks: number;
}

export function totals(entries: EgressEntry[]): EgressTotals {
  const sum = (kind: EgressKind) => entries.filter((e) => e.kind === kind).reduce((n, e) => n + e.bytes, 0);
  return {
    rawBytes: sum("RAW_TEXT"),
    cleanBytes: sum("CLEAN_QUERY"),
    cloudChecks: entries.filter((e) => e.kind === "CLEAN_QUERY" && e.source !== null && e.outcome === "ok").length,
  };
}

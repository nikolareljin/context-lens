import {
  GatekeeperParser,
  PiiPostScrubber,
  Tier0Filter,
  VerdictRules,
  gatekeeperPrompt,
  prompts as defaultPrompts,
  regionLabel,
  type FactCard,
  type GatekeeperResult,
  type ModelReply,
  type PiiKind,
  type Prompt,
  type SessionContext,
} from "../domain";
import { EgressLedger, bytesOf } from "./ledger";

export type PrivacyMode = "STRICT" | "BALANCED";

export type Stage =
  /** Dropped by the Tier 0 rules; no model was called. */
  | "FILTERED"
  | "GATEKEEPING"
  /** The gatekeeper found no checkable claim. */
  | "NO_CLAIM"
  /** Strict mode without the on-device model: the sentence stays in the browser unchecked. */
  | "NEEDS_MODEL"
  /** The question still carried personal data, so it was not sent. */
  | "WITHHELD"
  | "VERIFYING"
  /** The cloud refused for quota or billing; the clean question can still be searched by the visitor. */
  | "CLOUD_UNAVAILABLE"
  /** No network: the clean question was not sent. */
  | "OFFLINE"
  /** No Firebase project is connected: the cloud step is off and nothing was sent. */
  | "NO_PROJECT"
  | "DONE"
  | "FAILED";

export interface GateInfo {
  result: GatekeeperResult;
  model: string;
  source: string | null;
  latencyMs: number;
}

/** Chrome's built-in model status (the Prompt API's availability()). */
export type DeviceStatus = "available" | "downloadable" | "downloading" | "unavailable";

/** The situation when a sentence could not be checked without Chrome's model, kept with it. */
export interface NeedsModelInfo {
  /** Chrome's model status then; null when it could not be asked. */
  device: DeviceStatus | null;
  projectConnected: boolean;
  /** The mode the sentence was submitted in. */
  mode: PrivacyMode;
}

/** One sentence on its way through the pipeline. The raw text stays in memory only. */
export interface Check {
  id: number;
  utterance: string;
  atMillis: number;
  stage: Stage;
  gate?: GateInfo;
  card?: FactCard;
  withheld: PiiKind[];
  note?: string;
  /** Fed by the demo script, not typed; the card says so. */
  demo: boolean;
  /** The sentence and its context went to the cloud gatekeeper (or may have); recorded in the ledger. */
  sentToCloud: boolean;
  /** Set with the NEEDS_MODEL stage: what was true at that moment, so the card does not change later. */
  needsModel?: NeedsModelInfo;
}

export interface PipelineCounts {
  processed: number;
  filtered: number;
  withheld: number;
  /** Sentences only the browser read: stopped by the local rules or read by the on-device model. */
  readOnDevice: number;
  /** Sentences the cloud may have read (Balanced fallback). */
  readInCloud: number;
  rawBytes: number;
  checked: number;
}

const ZERO: PipelineCounts = { processed: 0, filtered: 0, withheld: 0, readOnDevice: 0, readInCloud: 0, rawBytes: 0, checked: 0 };

/** A model as the pipeline sees it: Firebase AI Logic on the page, fakes in tests. */
export interface TextModel {
  readonly name: string;
  /** [signal] aborts the request: on a timeout, Clear, or when the project is disconnected. */
  generate(prompt: string, signal?: AbortSignal): Promise<ModelReply>;
}

export interface ModelSource {
  gatekeeper(mode: PrivacyMode): TextModel;
  /** Grounded cloud verifiers, in the order to try. */
  verifiers(): TextModel[];
  /** False when the on-device model is missing or not downloaded yet. */
  onDeviceReady(): Promise<boolean>;
  /** Called with the verifier that answered, so it is tried first next time. */
  verifierAnswered?(name: string): void;
  /** The on-device model's own name; null when not known. */
  onDeviceName?(): string | null;
}

export interface PipelinePrompts {
  gatekeeper: Prompt;
  verifier: Prompt;
}

/** The moment the checker knows about; "recent" is kept by the pipeline. */
export type SessionBase = Omit<SessionContext, "recent">;

export interface PipelineSnapshot {
  /** Newest first. */
  checks: Check[];
  counts: PipelineCounts;
}

export interface PipelineOptions {
  models: ModelSource;
  ledger?: EgressLedger;
  prompts?: PipelinePrompts;
  /** False when no Firebase project is connected: on-device only, no cloud step, nothing sent. */
  cloudProject: () => boolean;
  online?: () => boolean;
  /** Chrome's model status, recorded on a sentence that could not be checked without it. */
  deviceStatus?: () => Promise<DeviceStatus>;
  clock?: () => number;
  gateTimeoutMs?: number;
  verifyTimeoutMs?: number;
}

export const ON_DEVICE = "ON_DEVICE";
/** As on Android (HybridContextPipeline.GATE_TIMEOUT_MS and VERIFY_TIMEOUT_MS). */
export const GATE_TIMEOUT_MS = 15_000;
export const VERIFY_TIMEOUT_MS = 30_000;
export const ON_DEVICE_MODEL_LABEL = "Gemini Nano in Chrome";
export const MAYBE_SENT = "may have been sent";
export const CHECKS_MAX = 30;
export const RECENT_LIMIT = 3;

interface Work {
  id: number;
  text: string;
  context: SessionContext;
  mode: PrivacyMode;
  session: number;
}

interface Outcome {
  reply: ModelReply | null;
  label: string;
}

/**
 * Sentence → local rules → on-device gatekeeper → personal-data check → grounded cloud
 * verifier → verdict rules, as on Android (HybridContextPipeline.kt). Sentences are processed
 * one at a time, in order. Every request that leaves the browser goes into [ledger].
 */
export class WebPipeline {
  readonly ledger: EgressLedger;
  private readonly models: ModelSource;
  private readonly prompts: PipelinePrompts;
  private readonly cloudProject: () => boolean;
  private readonly deviceStatus?: () => Promise<DeviceStatus>;
  private readonly online: () => boolean;
  private readonly clock: () => number;
  private readonly gateTimeoutMs: number;
  private readonly verifyTimeoutMs: number;

  private snapshot: PipelineSnapshot = { checks: [], counts: ZERO };
  private listeners = new Set<() => void>();
  private ids = 0;
  private session = 0;
  private recent: string[] = [];
  private base: SessionBase;
  private mode: PrivacyMode = "STRICT";
  private queue: Promise<void> = Promise.resolve();
  /** Requests in progress; Clear and close() abort them. */
  private inflight = new Set<AbortController>();
  private closed = false;

  constructor(options: PipelineOptions) {
    this.models = options.models;
    this.ledger = options.ledger ?? new EgressLedger();
    this.prompts = options.prompts ?? defaultPrompts;
    this.cloudProject = options.cloudProject;
    this.online = options.online ?? (() => globalThis.navigator?.onLine ?? true);
    this.deviceStatus = options.deviceStatus;
    this.clock = options.clock ?? Date.now;
    this.gateTimeoutMs = options.gateTimeoutMs ?? GATE_TIMEOUT_MS;
    this.verifyTimeoutMs = options.verifyTimeoutMs ?? VERIFY_TIMEOUT_MS;
    this.base = { today: new Date().toISOString().slice(0, 10) };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): PipelineSnapshot => this.snapshot;

  private emit(next: Partial<PipelineSnapshot>) {
    this.snapshot = { ...this.snapshot, ...next };
    this.listeners.forEach((l) => l());
  }

  setMode(mode: PrivacyMode) {
    this.mode = mode;
  }

  setSession(base: SessionBase) {
    this.base = base;
  }

  /** Resolves when every sentence submitted so far has reached a final stage. */
  idle(): Promise<void> {
    return this.queue;
  }

  /** Takes one finished sentence (typed or from the demo script). Returns its id, or null for blank text. */
  submit(text: string, demo = false): number | null {
    if (this.closed) return null;
    const clean = text.trim().replace(/\s+/g, " ");
    if (clean.length === 0) return null;
    // The context as it was before this sentence: "recent" means the sentences before it.
    const context: SessionContext = { ...this.base, recent: [...this.recent] };
    this.recent = [...this.recent, clean].slice(-RECENT_LIMIT);
    const id = ++this.ids;
    this.count(this.session, (c) => ({ ...c, processed: c.processed + 1 }));
    const decision = Tier0Filter.check(clean);
    const check: Check = { id, utterance: clean, atMillis: this.clock(), stage: "GATEKEEPING", withheld: [], demo, sentToCloud: false };
    if (decision.type === "drop") {
      this.put({ ...check, stage: "FILTERED", note: decision.reason });
      this.count(this.session, (c) => ({ ...c, filtered: c.filtered + 1, readOnDevice: c.readOnDevice + 1 }));
    } else {
      this.put(check);
      const work: Work = { id, text: clean, context, mode: this.mode, session: this.session };
      this.queue = this.queue.then(() => this.process(work));
    }
    return id;
  }

  /**
   * Forgets every sentence and the recent context, as on Android: queued sentences never reach
   * a model and the request in progress is aborted. The ledger is kept.
   */
  clear() {
    this.session++;
    this.abortAll();
    this.recent = [];
    this.emit({ checks: [], counts: ZERO });
  }

  /**
   * Stops for good (the project was disconnected or changed): nothing queued or in progress
   * reaches a model after this, and nothing new is taken.
   */
  close() {
    this.closed = true;
    this.session++;
    this.abortAll();
  }

  private abortAll() {
    this.inflight.forEach((c) => c.abort(new DOMException("cleared", "AbortError")));
    this.inflight.clear();
  }

  /** True once Clear or close() has made this sentence's session a past one. */
  private stale(work: Work): boolean {
    return this.closed || work.session !== this.session;
  }

  private count(session: number, change: (c: PipelineCounts) => PipelineCounts) {
    if (session === this.session) this.emit({ counts: change(this.snapshot.counts) });
  }

  private put(check: Check) {
    this.emit({ checks: [check, ...this.snapshot.checks].slice(0, CHECKS_MAX) });
  }

  private update(work: Work, change: (c: Check) => Check) {
    if (work.session !== this.session) return;
    this.emit({ checks: this.snapshot.checks.map((c) => (c.id === work.id ? change(c) : c)) });
  }

  private async process(work: Work): Promise<void> {
    // Queued before Clear or close(): it never reaches a model.
    if (this.stale(work)) return;
    try {
      // Without a project, or after a switch to Strict, the gatekeeper runs on the device only.
      const mode: PrivacyMode = this.mode === "STRICT" || !this.cloudProject() ? "STRICT" : work.mode;
      const gate = await this.gatekeep(work, mode);
      if (gate === null) return;
      if (!gate.result.hasVerifiableClaim) {
        if (gate.source === ON_DEVICE) this.count(work.session, (c) => ({ ...c, filtered: c.filtered + 1 }));
        this.update(work, (c) => ({ ...c, stage: "NO_CLAIM", gate }));
        return;
      }
      const publicNames = [work.context.pinnedTopic, work.context.region ? regionLabel(work.context.region) : null].filter(
        (it): it is string => typeof it === "string" && it.length > 0,
      );
      const hits = PiiPostScrubber.findIn(gate.result.sanitizedResolvedQuery, work.text, publicNames, work.context.recent ?? []);
      if (hits.size > 0) {
        this.count(work.session, (c) => ({ ...c, withheld: c.withheld + 1 }));
        this.update(work, (c) => ({ ...c, stage: "WITHHELD", gate, withheld: [...hits] }));
        return;
      }
      if (this.stale(work)) return;
      this.update(work, (c) => ({ ...c, stage: "VERIFYING", gate }));
      await this.verify(work, gate.result.sanitizedResolvedQuery);
    } catch (e) {
      this.update(work, (c) => ({ ...c, stage: "FAILED", note: describe(e) }));
    }
  }

  private onDeviceLabel(): string {
    return this.models.onDeviceName?.() ?? ON_DEVICE_MODEL_LABEL;
  }

  private async gatekeep(work: Work, mode: PrivacyMode): Promise<GateInfo | null> {
    if (mode === "STRICT" && !(await this.models.onDeviceReady())) {
      let device: DeviceStatus | null = null;
      try {
        device = (await this.deviceStatus?.()) ?? null;
      } catch {
        device = null;
      }
      const needsModel: NeedsModelInfo = { device, projectConnected: this.cloudProject(), mode: work.mode };
      this.count(work.session, (c) => ({ ...c, readOnDevice: c.readOnDevice + 1 }));
      this.update(work, (c) => ({ ...c, stage: "NEEDS_MODEL", needsModel }));
      return null;
    }
    if (this.stale(work)) return null;
    const model = this.models.gatekeeper(mode);
    const prompt = gatekeeperPrompt(this.prompts.gatekeeper, work.context, work.text);
    const start = this.clock();
    const promptBytes = bytesOf(prompt);
    const rawText = (source: string | null, label: string) => {
      this.ledger.add({
        atMillis: start,
        kind: "RAW_TEXT",
        stage: "gatekeeper",
        model: model.name,
        text: prompt,
        bytes: promptBytes,
        source,
        latencyMs: this.clock() - start,
        promptVersion: this.prompts.gatekeeper.version,
        outcome: label,
      });
      this.count(work.session, (c) => ({ ...c, readInCloud: c.readInCloud + 1, rawBytes: c.rawBytes + promptBytes }));
      this.update(work, (c) => ({ ...c, sentToCloud: true }));
    };
    // A Strict call runs on the device only: stopping it never leaves anything "maybe sent".
    const outcome = await this.call(this.gateTimeoutMs, mode === "BALANCED", (signal) => model.generate(prompt, signal));
    const latency = this.clock() - start;
    const reply = outcome.reply;
    // Stopped midway: a Balanced call may already have been sent, so it is recorded; nothing else happens.
    if (this.stale(work)) {
      if (mode === "BALANCED" && reply?.source !== ON_DEVICE) rawText(reply?.source ?? null, reply === null ? maybeSent(outcome.label) : outcome.label);
      return null;
    }
    const onDevice = reply?.source === ON_DEVICE || (mode === "STRICT" && reply === null);
    if (onDevice) this.count(work.session, (c) => ({ ...c, readOnDevice: c.readOnDevice + 1 }));
    if (mode === "STRICT" && reply !== null && reply.source !== ON_DEVICE) {
      // Strict asked for the device only; a reply from anywhere else is recorded and not used.
      rawText(reply.source, `${outcome.label}; not on the device in Strict mode`);
      this.update(work, (c) => ({ ...c, stage: "FAILED", note: "gatekeeper did not run on the device" }));
      return null;
    }
    // Unless the reply says it ran on the device, count a Balanced call as sent.
    if (mode === "BALANCED" && reply?.source !== ON_DEVICE) {
      rawText(reply?.source ?? null, reply === null ? maybeSent(outcome.label) : outcome.label);
    }
    if (reply === null) {
      this.update(work, (c) => ({ ...c, stage: "FAILED", note: `gatekeeper: ${outcome.label}` }));
      return null;
    }
    const result = GatekeeperParser.parse(reply.text);
    if (result === null) {
      this.update(work, (c) => ({ ...c, stage: "FAILED", note: "gatekeeper reply was not valid" }));
      return null;
    }
    return { result, model: reply.source === ON_DEVICE ? this.onDeviceLabel() : model.name, source: reply.source, latencyMs: latency };
  }

  private async verify(work: Work, query: string): Promise<void> {
    if (this.stale(work)) return;
    if (!this.cloudProject()) {
      this.update(work, (c) => ({ ...c, stage: "NO_PROJECT" }));
      return;
    }
    // Without a network nothing can leave the browser, so nothing is tried or recorded as sent.
    if (!this.online()) {
      this.update(work, (c) => ({ ...c, stage: "OFFLINE" }));
      return;
    }
    const prompt = this.prompts.verifier.fill({ query });
    const bytes = bytesOf(prompt);
    let lastLabel = "no cloud model configured";
    for (const model of this.models.verifiers()) {
      if (this.stale(work)) return;
      const start = this.clock();
      const outcome = await this.call(this.verifyTimeoutMs, true, (signal) => model.generate(prompt, signal));
      const latency = this.clock() - start;
      const reply = outcome.reply;
      this.ledger.add({
        atMillis: start,
        kind: "CLEAN_QUERY",
        stage: "verifier",
        model: model.name,
        text: prompt,
        bytes,
        source: reply?.source ?? null,
        latencyMs: latency,
        promptVersion: this.prompts.verifier.version,
        outcome: outcome.label,
      });
      if (this.stale(work)) return;
      if (reply !== null && reply.text !== null && reply.text.trim().length > 0) {
        this.models.verifierAnswered?.(model.name);
        const card = VerdictRules.card(reply, model.name, latency);
        this.count(work.session, (c) => ({ ...c, checked: c.checked + 1 }));
        this.update(work, (c) => ({ ...c, stage: "DONE", card }));
        return;
      }
      lastLabel = outcome.label;
      // Quota and billing are per project: the next model would be refused the same way.
      if (isCloudLimit(outcome.label)) {
        this.update(work, (c) => ({ ...c, stage: "CLOUD_UNAVAILABLE", note: outcome.label }));
        return;
      }
      if (!this.online()) {
        this.update(work, (c) => ({ ...c, stage: "OFFLINE", note: outcome.label }));
        return;
      }
    }
    this.update(work, (c) => ({ ...c, stage: "FAILED", note: `verifier: ${lastLabel}` }));
  }

  /** One request with its own abort signal: a timeout, Clear or close() aborts it. */
  private async call(timeoutMs: number, mayLeave: boolean, block: (signal: AbortSignal) => Promise<ModelReply>): Promise<Outcome> {
    const stoppedLabel = (timedOut: boolean) => {
      const what = timedOut ? "timed out" : "cancelled";
      return mayLeave ? `${what}; ${MAYBE_SENT}` : what;
    };
    const controller = new AbortController();
    this.inflight.add(controller);
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stopped = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort(new DOMException("timed out", "TimeoutError"));
        resolve(null);
      }, timeoutMs);
      controller.signal.addEventListener("abort", () => resolve(null), { once: true });
    });
    try {
      const reply = await Promise.race([block(controller.signal), stopped]);
      if (reply === null) return { reply: null, label: stoppedLabel(timedOut) };
      return { reply, label: reply.text === null || reply.text.trim().length === 0 ? "ok, empty reply" : "ok" };
    } catch (e) {
      if (controller.signal.aborted) return { reply: null, label: stoppedLabel(timedOut) };
      return { reply: null, label: describe(e) };
    } finally {
      clearTimeout(timer);
      this.inflight.delete(controller);
    }
  }
}

const cloudLimit = /quota|billing|prepay|RESOURCE_EXHAUSTED|\b402\b|\b429\b/i;

/** True when a cloud failure means quota, rate limit or billing rather than a broken request. */
export function isCloudLimit(outcome: string): boolean {
  return cloudLimit.test(outcome);
}

/** A Google search for the clean question, opened in the visitor's own browser; the page sends nothing. */
export function searchUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

/** Addresses, app ids and long numbers are left out of messages shown on the page. */
export function redact(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, "<url>")
    .replace(/[\d:]+:(android|web|ios):[0-9a-f]+/g, "<app>")
    .replace(/AIza[0-9A-Za-z_-]{35}/g, "<key>")
    .replace(/\d{6,}/g, "<number>");
}

export function describe(e: unknown): string {
  const name = e instanceof Error ? e.name : "Error";
  const message = e instanceof Error ? e.message : String(e);
  const first = (message.split("\n")[0] ?? "").slice(0, 160);
  return `${name}: ${redact(first.length > 0 ? first : "no message")}`;
}

/** The outcome of a call that may have left the browser, said once. */
function maybeSent(label: string): string {
  return label.endsWith(MAYBE_SENT) ? label : `${label}; ${MAYBE_SENT}`;
}

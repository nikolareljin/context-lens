import { useEffect, useRef, type ReactNode } from "react";
import type { Check, PrivacyMode } from "../pipeline/pipeline";
import type { OnDeviceStatus } from "../cloud/firebaseModels";
import { CheckCard } from "./CheckCard";

type StepState = "done" | "running" | "stopped" | "waiting";

interface Step {
  title: string;
  where: string;
  state: StepState;
  text: ReactNode;
}

const PII_WORD: Record<string, string> = {
  EMAIL: "an email address",
  PHONE: "a phone number",
  CARD: "a card number",
  IBAN: "an account number",
  SSN: "an id number",
  ADDRESS: "a street address",
  NAME: "a name",
};

const AFTER_PII = new Set<Check["stage"]>(["VERIFYING", "CLOUD_UNAVAILABLE", "OFFLINE", "NO_PROJECT", "DONE", "FAILED"]);

/** Where the claim step runs: in Balanced mode the cloud may read the sentence while Nano isn't ready. */
function gateWhere(check: Check, mode: PrivacyMode): string {
  if (check.sentToCloud) return mode === "BALANCED" ? "cloud Gemini (Balanced mode)" : "cloud Gemini";
  if (mode === "BALANCED" && check.stage === "GATEKEEPING") return "Gemini Nano, or cloud Gemini (Balanced mode)";
  return "Gemini Nano, in this browser";
}

/** The four steps one sentence goes through, as far as it got. */
export function stepsOf(check: Check, mode: PrivacyMode = "STRICT"): Step[] {
  const s = check.stage;
  const question = check.gate?.result.sanitizedResolvedQuery ?? "";
  const refs = check.gate?.result.resolvedReferences ?? [];
  // A gatekeeper failure ends the run at the claim step, before any later check.
  const gateFailed = s === "FAILED" && check.gate === undefined;
  const sentenceWent = check.sentToCloud ? " The sentence itself went to cloud Gemini in step 2; the ledger lists it." : "";
  return [
    {
      title: "Local rules",
      where: "in this browser",
      state: s === "FILTERED" ? "stopped" : "done",
      text: s === "FILTERED" ? `Not a claim (${check.note ?? "small talk"}): dropped here. No model runs and nothing is sent.` : "Could be a claim: passed on.",
    },
    {
      title: "Claim and clean question",
      where: gateWhere(check, mode),
      state:
        s === "FILTERED"
          ? "waiting"
          : s === "GATEKEEPING"
            ? "running"
            : s === "NO_CLAIM" || s === "NEEDS_MODEL" || gateFailed
              ? "stopped"
              : "done",
      text:
        s === "FILTERED" ? (
          "Not needed."
        ) : s === "GATEKEEPING" ? (
          "Reading the sentence with its context…"
        ) : s === "NO_CLAIM" ? (
          `No checkable claim: stops here.${check.sentToCloud ? sentenceWent : " Nothing is sent."}`
        ) : s === "NEEDS_MODEL" ? (
          "Chrome's built-in model isn't ready in this browser, so in Strict mode the sentence stays here unchecked."
        ) : gateFailed ? (
          `${check.note ?? "Not checked."}${sentenceWent}`
        ) : (
          <>
            <span className="font-medium text-slate-100">“{question}”</span>
            {refs.length > 0 && <span className="block text-xs text-slate-400">Resolved: {refs.join(" · ")}</span>}
          </>
        ),
    },
    {
      title: "Personal-data check",
      where: "in this browser",
      state: s === "WITHHELD" ? "stopped" : AFTER_PII.has(s) && !gateFailed ? "done" : "waiting",
      text:
        s === "WITHHELD"
          ? `Found ${check.withheld.map((k) => PII_WORD[k] ?? k.toLowerCase()).join(", ")}: the clean question is withheld and not sent.${sentenceWent}`
          : "No personal data found (the area and topic you set are allowed).",
    },
    {
      title: "Grounded check",
      where: "cloud Gemini + Google Search",
      state: gateFailed
        ? "waiting"
        : s === "DONE"
          ? "done"
          : s === "VERIFYING"
            ? "running"
            : s === "NO_PROJECT" || s === "CLOUD_UNAVAILABLE" || s === "OFFLINE" || s === "FAILED"
              ? "stopped"
              : "waiting",
      text:
        s === "DONE"
          ? "Checked: the card is below."
          : s === "VERIFYING"
            ? "Only the clean question goes out…"
            : s === "NO_PROJECT"
              ? "No project connected, so nothing was sent. Paste an access code to run this step."
              : s === "CLOUD_UNAVAILABLE"
                ? "The clean question was sent, but the project refused it (quota or billing); the ledger lists it. The card offers a Google search instead."
                : s === "OFFLINE"
                  ? check.note !== undefined || check.sentToCloud
                    ? "The network was lost during the check. A request may have left before that; the ledger lists it."
                    : "Offline: the clean question was not sent."
                  : (check.note ?? "Not checked."),
    },
  ];
}

const DOT: Record<StepState, string> = {
  done: "bg-device",
  running: "bg-bridge animate-pulse",
  stopped: "bg-amber-400",
  waiting: "bg-slate-600",
};

const STATE_WORD: Record<StepState, string> = { done: "done", running: "running", stopped: "stopped here", waiting: "not reached" };

function SentenceRun({ check, today, device, mode }: { check: Check; today: string; device: OnDeviceStatus | null; mode: PrivacyMode }) {
  const steps = stepsOf(check, mode);
  const showCard = ["DONE", "CLOUD_UNAVAILABLE", "WITHHELD", "OFFLINE", "NO_PROJECT", "FAILED"].includes(check.stage);
  return (
    <li className="rounded-2xl border border-edge bg-slate-950/70 p-4" data-testid="run-sentence">
      <p className="text-xs font-bold tracking-widest text-device">SENTENCE</p>
      <p className="mt-1 text-lg">“{check.utterance}”</p>
      <ol className="mt-3 flex flex-col gap-2">
        {steps
          .filter((step) => step.state !== "waiting")
          .map((step, i) => (
            <li key={step.title} className="flex gap-3">
              <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${DOT[step.state]}`} aria-hidden="true" />
              <div className="text-sm">
                <p>
                  <span className="font-semibold">{i + 1}. {step.title}</span>{" "}
                  <span className="text-slate-400">· {step.where} · {STATE_WORD[step.state]}</span>
                </p>
                <div className="text-slate-300">{step.text}</div>
              </div>
            </li>
          ))}
      </ol>
      {showCard && (
        <div className="mt-3">
          <CheckCard check={check} today={today} context={{ device }} />
        </div>
      )}
    </li>
  );
}

interface Props {
  /** Newest first, as the pipeline keeps them. */
  checks: Check[];
  today: string;
  device: OnDeviceStatus | null;
  running: boolean;
  total: number;
  /** One line on where the cloud step runs (a connected project, or none). */
  cloudLine: string;
  /** The model status line and its download button. */
  deviceLine: ReactNode;
  mode: PrivacyMode;
  onClose: () => void;
  onAgain: () => void;
}

/**
 * The demo run as a full-page view from the top: each sentence of the script appears in
 * turn and opens step by step, as far as it got (local rules, the clean question, the
 * personal-data check, the grounded check).
 */
export function DemoRun({ checks, today, device, running, total, cloudLine, deviceLine, mode, onClose, onAgain }: Props) {
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const opener = useRef<Element | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const shown = [...checks].reverse();

  useEffect(() => {
    opener.current = document.activeElement;
    closeButton.current?.focus();
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      (opener.current as HTMLElement | null)?.focus?.();
    };
  }, []);

  // Each new sentence comes into view as it arrives, the last one included (without
  // animation when the visitor asked for reduced motion).
  const seen = useRef(checks.length);
  useEffect(() => {
    const grew = checks.length > seen.current;
    seen.current = checks.length;
    if (!grew) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    end.current?.scrollIntoView?.({ behavior: reduce ? "auto" : "smooth", block: "nearest" });
  }, [checks.length]);

  // Escape closes from anywhere (focus may be on the page body after a click on text), and
  // Tab stays inside the view.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab" || dialog.current === null) return;
      const items = Array.from(dialog.current.querySelectorAll<HTMLElement>("button, a[href], input, textarea, select"));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const inside = dialog.current.contains(document.activeElement);
      if (e.shiftKey && (document.activeElement === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", keys);
    return () => document.removeEventListener("keydown", keys);
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="run-title"
      ref={dialog}
      tabIndex={-1}
      className="fixed inset-0 z-20 overflow-y-auto bg-ink"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6 sm:px-8">
        <header className="sticky top-0 z-10 -mx-4 flex flex-wrap items-center justify-between gap-3 border-b border-edge bg-ink px-4 py-3 sm:-mx-8 sm:px-8">
          <div>
            <h2 id="run-title" className="text-xl font-semibold">Demo run, live in this browser</h2>
            <p className="text-sm text-slate-400" data-testid="run-progress" aria-live="polite">
              Sentence {Math.min(checks.length, total)} of {total}
              {running ? " · running" : " · finished"}
            </p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onAgain} className="rounded-full border border-edge px-4 py-1 hover:border-device">
              {running ? "Restart" : "Run again"}
            </button>
            <button ref={closeButton} type="button" onClick={onClose} className="rounded-full bg-bridge px-4 py-1 font-medium text-white hover:bg-cloud">
              Close
            </button>
          </div>
        </header>
        <div className="lens-gradient h-0.5 w-full rounded" aria-hidden="true" />
        <p className="text-sm text-slate-300">
          A short conversation in Springfield about city bus fares. Each sentence goes through the same steps as in the Android
          app; the dots show how far it got and where it ran.
        </p>
        <p className="text-xs text-slate-400">{cloudLine}</p>
        <div className="text-xs text-slate-400">{deviceLine}</div>
        <ol className="flex flex-col gap-4">
          {shown.map((c) => (
            <SentenceRun key={c.id} check={c} today={today} device={device} mode={mode} />
          ))}
        </ol>
        <div ref={end} />
      </div>
    </div>
  );
}

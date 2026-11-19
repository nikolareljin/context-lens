import type { ReactNode } from "react";
import { DateResolver, type Verdict } from "../domain";
import { ON_DEVICE, searchUrl, type Check, type NeedsModelInfo } from "../pipeline/pipeline";
import { CHIP_SANDBOX, chipDocument } from "../lib/searchChip";
import type { OnDeviceStatus } from "../cloud/firebaseModels";

const VERDICT_LABEL: Record<Verdict, string> = {
  VERIFIED: "✓ Verified",
  NUANCED: "≈ Nuanced",
  FALSE: "✗ False",
  INSUFFICIENT_EVIDENCE: "? Not enough evidence",
};

const VERDICT_CLASS: Record<Verdict, string> = {
  VERIFIED: "border-verified text-verified",
  NUANCED: "border-amber-400 text-amber-300",
  FALSE: "border-red-400 text-red-300",
  INSUFFICIENT_EVIDENCE: "border-slate-500 text-slate-300",
};

function dotClass(source: string | null | undefined): string {
  return source === ON_DEVICE ? "bg-device" : "bg-cloud";
}

function StageLabel({ text, dot, children }: { text: string; dot: string; children?: ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-xs font-medium text-slate-400">
      <span className={`inline-block h-2 w-2 rounded-full ${dot}`} aria-hidden="true" />
      {text}
      {children}
    </p>
  );
}

function SourcePill({ source, latencyMs, model, extra }: { source: string | null; latencyMs: number; model: string; extra?: string }) {
  const where = source === ON_DEVICE ? "border-device/60 text-device" : "border-cloud/60 text-cloud";
  return (
    <p className="flex flex-wrap gap-2 text-xs">
      <span className={`rounded-full border px-2 py-0.5 font-mono ${where}`} data-testid="source-pill">{source ?? "?"}</span>
      <span className="text-slate-400">{latencyMs} ms · {model}{extra ? ` · ${extra}` : ""}</span>
    </p>
  );
}

/** What the first stage may claim, as on Android: "sent" whenever the ledger has the sentence. */
function heardLabel(check: Check): [string, string] {
  if (check.sentToCloud) return ["Heard · sent to cloud Gemini", "bg-cloud"];
  if (check.stage === "FILTERED" || check.stage === "NEEDS_MODEL" || check.gate?.source === ON_DEVICE) {
    return ["Heard · stays in this browser", "bg-device"];
  }
  return ["Heard", "bg-slate-500"];
}

/** The page now, for what a card may add to what was true when the sentence was checked. */
export interface CardContext {
  /** Chrome's built-in model status now; null while it is being checked. */
  device: OnDeviceStatus | null;
}

/**
 * Why a sentence was not checked without Chrome's model, as it was at that moment (recorded
 * on the check), so the text never changes into something untrue later. Only "ready now" is
 * added from the page's current state.
 */
export function needsModelText(info: NeedsModelInfo | undefined, deviceNow: OnDeviceStatus | null): string {
  const device = info?.device ?? null;
  let text = "Not checked: Strict mode reads sentences only with Chrome's built-in model (Gemini Nano), ";
  if (device === "downloadable") {
    text += "which wasn't downloaded yet. Nothing was sent. Use Download Gemini Nano above and check it again.";
  } else if (device === "downloading") {
    text += "and Chrome was still downloading it. Nothing was sent. Check it again once the download has finished.";
  } else {
    text += "which wasn't available in this browser, so only the local rules ran. Nothing was sent.";
  }
  if (info?.projectConnected && info.mode === "STRICT") {
    text += " Or switch to Balanced and check it again: your project's cloud Gemini then reads the sentence (it is sent to the cloud, as the mode says).";
  }
  if (deviceNow === "available" && device !== "available") {
    text += " Gemini Nano is ready now; check the sentence again.";
  }
  return text;
}

function stageText(check: Check, context: CardContext): string {
  switch (check.stage) {
    case "FILTERED":
      return `Not a claim (local rules: ${check.note ?? ""}). No model was called.`;
    case "GATEKEEPING":
      return check.note ?? "Reading the sentence…";
    case "NO_CLAIM":
      return `No checkable claim · ${check.gate ? `${check.gate.source ?? "?"} · ${check.gate.latencyMs} ms · ${check.gate.model}` : ""}`;
    case "NEEDS_MODEL":
      return needsModelText(check.needsModel, context.device);
    case "WITHHELD":
      return `Question withheld: it still contained personal data (${check.withheld.map((k) => k.toLowerCase()).join(", ")}). Nothing was sent.`;
    case "VERIFYING":
      return "Checking with Google Search…";
    case "CLOUD_UNAVAILABLE":
      return `Cloud check unavailable right now (quota or billing limit). The question was written ${
        check.gate?.source === ON_DEVICE ? "in this browser" : "by your project's cloud Gemini"
      }; you can search it yourself.`;
    case "OFFLINE":
      return check.note !== undefined || check.sentToCloud
        ? "Not checked in the cloud: the network was lost during the check. A request may have left before that; the ledger lists it."
        : "Not checked in the cloud: this browser is offline. Nothing was sent; you can search the question when you are back online.";
    case "NO_PROJECT":
      return "Not checked in the cloud: no Firebase project is connected. The question was written in this browser and nothing was sent; you can search it yourself.";
    case "DONE":
      return "Checked";
    case "FAILED":
      return `Not checked: ${check.note ?? ""}`;
  }
}

/** Google's Search Suggestions chip, cleaned and isolated: no script runs and nothing loads. */
export function SearchSuggestions({ html }: { html: string }) {
  return (
    <iframe
      title="Google Search Suggestions"
      sandbox={CHIP_SANDBOX}
      referrerPolicy="no-referrer"
      srcDoc={chipDocument(html)}
      className="h-16 w-full rounded-lg border-0 bg-transparent"
    />
  );
}

/** One sentence and what happened to it: the sentence, the clean question, the grounded verdict. */
export function CheckCard({
  check,
  today,
  context = { device: null },
}: {
  check: Check;
  today: string;
  context?: CardContext;
}) {
  const [heard, heardDot] = heardLabel(check);
  const mention = DateResolver.resolve(check.utterance, today);
  const gate = check.gate?.result.hasVerifiableClaim ? check.gate : undefined;
  const card = check.card;
  const query = check.gate?.result.sanitizedResolvedQuery ?? "";
  return (
    <article className="flex flex-col gap-2 rounded-xl border border-edge bg-slate-950/70 p-4" data-stage={check.stage}>
      <StageLabel text={heard} dot={heardDot}>
        {check.demo && <span className="rounded-full border border-edge px-2 text-[10px] text-slate-400">Demo input</span>}
      </StageLabel>
      <p>{check.utterance}</p>
      {mention && (
        <p className="text-xs text-slate-400">
          “{mention.phrase}” = {mention.start === mention.end ? mention.start : `${mention.start} – ${mention.end}`}
        </p>
      )}

      {gate && (
        <div className="flex flex-col gap-1 border-t border-edge pt-2">
          <StageLabel text={gate.source === ON_DEVICE ? "Clean question · written on the device" : "Clean question · written in the cloud"} dot={dotClass(gate.source)} />
          <p className="font-medium">{gate.result.sanitizedResolvedQuery}</p>
          {gate.result.resolvedReferences.length > 0 && (
            <p className="flex flex-wrap gap-1 text-xs">
              {gate.result.resolvedReferences.map((r) => (
                <span key={r} className="rounded-full border border-edge px-2 text-slate-400">{r.replace("->", "→")}</span>
              ))}
            </p>
          )}
          <SourcePill source={gate.source} latencyMs={gate.latencyMs} model={gate.model} />
        </div>
      )}

      {card && (
        <div className="flex flex-col gap-1 border-t border-edge pt-2">
          <StageLabel text="Grounded check · Google Search" dot={dotClass(card.source)} />
          <p><span className={`rounded-full border px-3 py-0.5 text-sm font-semibold ${VERDICT_CLASS[card.verdict]}`}>{VERDICT_LABEL[card.verdict]}</span></p>
          {card.modelVerdict !== null && card.modelVerdict !== card.verdict && (
            <p className="text-xs text-slate-400">No web source came back, so the verdict is shown as not enough evidence.</p>
          )}
          {card.summary.length > 0 && <p className="text-sm">{card.summary}</p>}
          {card.grounding.citations.length > 0 && (
            <ul className="text-xs">
              {card.grounding.citations.map((c) => (
                <li key={c.uri}>
                  <a className="text-device underline" href={c.uri} target="_blank" rel="noopener noreferrer">{c.title} ({c.domain})</a>
                </li>
              ))}
            </ul>
          )}
          {card.grounding.searchEntryPointHtml !== null ? (
            <SearchSuggestions html={card.grounding.searchEntryPointHtml} />
          ) : (
            card.grounding.searchQueries.length > 0 && <p className="text-xs text-slate-400">Searched: {card.grounding.searchQueries.join(" · ")}</p>
          )}
          <SourcePill source={card.source} latencyMs={card.latencyMs} model={card.model} extra="grounded" />
        </div>
      )}

      {check.stage !== "DONE" && <p className="text-xs text-slate-400" data-testid="stage-text">{stageText(check, context)}</p>}
      {(check.stage === "CLOUD_UNAVAILABLE" || check.stage === "OFFLINE" || check.stage === "NO_PROJECT") && (
        <a className="text-xs text-device underline" href={searchUrl(query)} target="_blank" rel="noopener noreferrer">
          Search this in your browser
        </a>
      )}
    </article>
  );
}

import { useState, useSyncExternalStore } from "react";
import { totals, type EgressLedger } from "../pipeline/ledger";

/** Every request that left this browser, word for word, with its size. In memory only. */
export function LedgerPanel({ ledger }: { ledger: EgressLedger }) {
  const entries = useSyncExternalStore(ledger.subscribe, () => ledger.entries);
  const sums = totals(entries);
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(ledger.export()).then(() => setCopied(true), () => setCopied(false));
  };
  return (
    <section aria-labelledby="ledger-title" className="rounded-xl border border-edge bg-slate-950/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="ledger-title" className="font-semibold">Egress ledger</h3>
        <div className="flex gap-2 text-sm">
          <button type="button" onClick={copy} disabled={entries.length === 0} className="rounded-full border border-edge px-3 py-0.5 hover:border-device disabled:opacity-40">
            {copied ? "Copied" : "Copy ledger"}
          </button>
          <button type="button" onClick={() => ledger.clear()} disabled={entries.length === 0} className="rounded-full border border-edge px-3 py-0.5 hover:border-device disabled:opacity-40">
            Clear
          </button>
        </div>
      </div>
      <p className="mt-1 text-xs text-slate-400" data-testid="ledger-totals">
        Raw text sent: {sums.rawBytes} B · clean questions: {sums.cleanBytes} B · grounded answers: {sums.cloudChecks}
      </p>
      {entries.length === 0 ? (
        <p className="mt-2 text-sm text-slate-300">No request has left this browser.</p>
      ) : (
        <ol className="mt-2 flex flex-col gap-2">
          {entries.map((e, i) => (
            <li key={`${e.atMillis}-${i}`} className="rounded-lg border border-edge p-2 text-xs" data-testid="ledger-entry">
              <p className="text-slate-400">
                {new Date(e.atMillis).toLocaleTimeString()} · {e.stage} · {e.kind} · {e.model} · source {e.source ?? "none"} · {e.latencyMs} ms ·{" "}
                <strong className="text-slate-200">{e.bytes} B</strong> · {e.outcome}
              </p>
              <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-slate-200">{e.text}</pre>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

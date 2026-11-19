import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { localToday } from "../domain";
import { FirebaseModelSource, forgetFirebaseStorage, onDeviceStatus, type OnDeviceStatus, type SetupRecorder } from "../cloud/firebaseModels";
import { clearProject, loadProject, saveProject, type WebProject } from "../cloud/project";
import { DemoScript } from "../pipeline/demoScript";
import { EgressLedger } from "../pipeline/ledger";
import { WebPipeline, type ModelSource, type PrivacyMode } from "../pipeline/pipeline";
import { CheckCard } from "./CheckCard";
import { ConnectPanel } from "./ConnectPanel";
import { LedgerPanel } from "./LedgerPanel";

/** A model source the demo can drop when the project changes. */
export interface DemoModels extends ModelSource {
  dispose?(): Promise<void>;
  prepareOnDevice?(progress?: (fraction: number) => void): Promise<void>;
}

export interface DemoProps {
  /** Tests pass fakes; the page uses Firebase AI Logic. */
  createModels?: (project: WebProject | null, setup: SetupRecorder) => DemoModels;
  status?: () => Promise<OnDeviceStatus>;
  demoGapMs?: number;
}

const STATUS_TEXT: Record<OnDeviceStatus, string> = {
  available: "Gemini Nano is ready in this browser.",
  downloadable: "Chrome can download Gemini Nano for this page.",
  downloading: "Chrome is downloading Gemini Nano…",
  unavailable: "Gemini Nano isn't available in this browser; only the local rules run on the device.",
};

const defaultModels = (project: WebProject | null, setup: SetupRecorder): DemoModels => new FirebaseModelSource(project, setup);

/** The live demo: the same pipeline as the Android app, typed sentences instead of speech. */
export function DemoSection({ createModels = defaultModels, status = onDeviceStatus, demoGapMs = DemoScript.lineGapMs }: DemoProps) {
  // Only a project the visitor chose to remember is in storage; otherwise it lives in this state.
  const [project, setProject] = useState<WebProject | null>(() => loadProject());
  const [remembered, setRemembered] = useState(() => project !== null);
  const [mode, setMode] = useState<PrivacyMode>("STRICT");
  const [text, setText] = useState("");
  const [today, setToday] = useState(() => localToday());
  const [area, setArea] = useState("");
  const [topic, setTopic] = useState("");
  const [device, setDevice] = useState<OnDeviceStatus | null>(null);
  const [preparing, setPreparing] = useState<string | null>(null);
  const [demoRunning, setDemoRunning] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // In memory only; kept across project changes so the record of what left stays complete.
  const ledger = useMemo(() => new EgressLedger(), []);

  // A new project means a new Firebase instance and a fresh pipeline.
  const models = useMemo(
    () =>
      createModels(project, (what, outcome) =>
        ledger.add({
          atMillis: Date.now(),
          kind: "SETUP",
          stage: "setup",
          model: "firebase",
          text: `${what}. No sentence or question of yours is in this request.`,
          bytes: 0,
          source: null,
          latencyMs: 0,
          promptVersion: "-",
          outcome,
        }),
      ),
    [project, createModels, ledger],
  );
  useEffect(() => () => void models.dispose?.(), [models]);

  const pipeline = useMemo(() => new WebPipeline({ models, ledger, cloudProject: () => project !== null }), [models, ledger, project]);
  const snapshot = useSyncExternalStore(pipeline.subscribe, pipeline.getSnapshot);

  const effectiveMode: PrivacyMode = project === null ? "STRICT" : mode;
  pipeline.setMode(effectiveMode);
  pipeline.setSession({
    today,
    region: area.trim() ? { city: area.trim(), area: "", country: "" } : null,
    pinnedTopic: topic.trim() || null,
  });

  useEffect(() => {
    let live = true;
    void status().then((s) => live && setDevice(s));
    return () => {
      live = false;
    };
  }, [status, preparing]);

  const stopDemo = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setDemoRunning(false);
  };
  useEffect(() => stopDemo, [pipeline]);

  const runDemo = () => {
    stopDemo();
    pipeline.clear();
    setArea(DemoScript.region.city);
    setTopic(DemoScript.topic);
    pipeline.setSession({ today, region: DemoScript.region, pinnedTopic: DemoScript.topic });
    setDemoRunning(true);
    DemoScript.lines.forEach((line, i) => {
      timers.current.push(
        setTimeout(() => {
          pipeline.submit(line, true);
          if (i === DemoScript.lines.length - 1) setDemoRunning(false);
        }, i * demoGapMs),
      );
    });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (pipeline.submit(text) !== null) setText("");
  };

  const connect = (p: WebProject, remember: boolean) => {
    stopDemo();
    if (remember) {
      setRemembered(saveProject(p));
    } else {
      clearProject();
      setRemembered(false);
    }
    setProject(p);
  };
  const disconnect = () => {
    stopDemo();
    clearProject();
    forgetFirebaseStorage();
    setProject(null);
    setRemembered(false);
    setMode("STRICT");
  };

  const prepare = async () => {
    if (!models.prepareOnDevice) return;
    setPreparing("Starting the download…");
    try {
      await models.prepareOnDevice((f) => setPreparing(`Downloading… ${Math.round(f * 100)}%`));
      setPreparing(null);
    } catch (e) {
      setPreparing(`Download did not start: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const counts = snapshot.counts;

  return (
    <section aria-labelledby="web-demo" className="flex flex-col gap-4 rounded-2xl border border-edge bg-panel/60 p-6">
      <div>
        <h2 id="web-demo" className="text-xl font-semibold">Try it in Chrome</h2>
        <p className="mt-1 text-slate-300">
          Type a sentence from a conversation, or run the demo. The local rules and Chrome's built-in Gemini Nano read it
          in this browser; only a clean question goes to the cloud, and only to a Firebase project you connect. The
          microphone stays off: Chrome's speech recognition sends audio to Google.
        </p>
      </div>

      <ConnectPanel project={project} remembered={remembered} onConnect={connect} onDisconnect={disconnect} />

      <fieldset className="flex flex-col gap-2 rounded-xl border border-edge p-4">
        <legend className="px-1 text-sm font-semibold">Privacy mode</legend>
        <label className="flex items-start gap-2 text-sm">
          <input type="radio" name="mode" checked={effectiveMode === "STRICT"} onChange={() => setMode("STRICT")} />
          <span>Strict: sentences are read only by the model in this browser. Without it, nothing is checked.</span>
        </label>
        <label className={`flex items-start gap-2 text-sm ${project === null ? "opacity-50" : ""}`}>
          <input type="radio" name="mode" disabled={project === null} checked={effectiveMode === "BALANCED"} onChange={() => setMode("BALANCED")} />
          <span>
            Balanced: if this browser can't run the model, the sentence is sent to cloud Gemini in your project.
            {project === null && " (Connect a project first.)"}
          </span>
        </label>
        <p className="text-xs text-slate-400" data-testid="device-status">
          {device === null ? "Checking Chrome's built-in model…" : STATUS_TEXT[device]}{" "}
          {device === "downloadable" && models.prepareOnDevice && (
            <button type="button" onClick={() => void prepare()} className="ml-1 rounded-full border border-edge px-2 hover:border-device">
              Download Gemini Nano
            </button>
          )}
          {preparing && <span className="ml-1">{preparing}</span>}
        </p>
      </fieldset>

      <fieldset className="grid gap-3 rounded-xl border border-edge p-4 sm:grid-cols-3">
        <legend className="px-1 text-sm font-semibold">Session context (in memory only)</legend>
        <label className="flex flex-col gap-1 text-sm">
          Date
          <input type="date" value={today} onChange={(e) => e.target.value && setToday(e.target.value)} className="rounded-lg border border-edge bg-ink px-2 py-1" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Area (nearest city)
          <input value={area} onChange={(e) => setArea(e.target.value)} placeholder="Springfield" className="rounded-lg border border-edge bg-ink px-2 py-1" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Pinned topic
          <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="city bus fares" className="rounded-lg border border-edge bg-ink px-2 py-1" />
        </label>
      </fieldset>

      <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="sentence" className="sr-only">Sentence</label>
        <input
          id="sentence"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="They raised it again here last month."
          autoComplete="off"
          className="flex-1 rounded-full border border-edge bg-ink px-4 py-2"
        />
        <div className="flex gap-2">
          <button type="submit" className="rounded-full bg-bridge px-5 py-2 font-medium text-white hover:bg-cloud">Check</button>
          <button type="button" onClick={demoRunning ? stopDemo : runDemo} className="rounded-full border border-edge px-5 py-2 hover:border-device">
            {demoRunning ? "Stop demo" : "Run demo"}
          </button>
          <button type="button" onClick={() => { stopDemo(); pipeline.clear(); }} className="rounded-full border border-edge px-5 py-2 hover:border-device">
            Clear
          </button>
        </div>
      </form>

      <p className="text-xs text-slate-400" data-testid="counts">
        Processed {counts.processed} · filtered in this browser {counts.filtered} · withheld for personal data {counts.withheld} · read
        in the cloud {counts.readInCloud} ({counts.rawBytes} B) · checked {counts.checked}
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-3" aria-live="polite">
          {snapshot.checks.length === 0 ? (
            <p className="text-sm text-slate-400">No sentences yet.</p>
          ) : (
            snapshot.checks.map((c) => <CheckCard key={c.id} check={c} today={today} />)
          )}
        </div>
        <LedgerPanel ledger={ledger} />
      </div>
    </section>
  );
}

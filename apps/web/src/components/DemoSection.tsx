import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { localToday } from "../domain";
import {
  FirebaseModelSource,
  forgetFirebaseStorage,
  forgetRecaptchaStorage,
  onDeviceStatus,
  type OnDeviceStatus,
  type SetupRecorder,
} from "../cloud/firebaseModels";
import { STORAGE_KEY, clearProject, loadProject, parseStored, sameProject, saveProject, type WebProject } from "../cloud/project";
import { DemoScript } from "../pipeline/demoScript";
import { EgressLedger } from "../pipeline/ledger";
import { WebPipeline, type Check, type ModelSource, type PipelineSnapshot, type PrivacyMode } from "../pipeline/pipeline";
import { CheckCard } from "./CheckCard";
import { ConnectPanel } from "./ConnectPanel";
import { LedgerPanel } from "./LedgerPanel";

/** A model source the demo can drop when the project changes. */
export interface DemoModels extends ModelSource {
  dispose?(): Promise<void>;
  prepareOnDevice?(progress?: (fraction: number) => void): Promise<void>;
  /** True once App Check was set up, which keeps a token in IndexedDB until the page reloads. */
  readonly usedAppCheck?: boolean;
}

export interface DemoProps {
  /** Tests pass fakes; the page uses Firebase AI Logic. */
  createModels?: (project: WebProject | null, setup: SetupRecorder) => DemoModels;
  status?: () => Promise<OnDeviceStatus>;
  demoGapMs?: number;
  /** Reloads the page; the startup cleanup then deletes what App Check stored. */
  reload?: () => void;
}

const STATUS_TEXT: Record<OnDeviceStatus, string> = {
  available: "Gemini Nano is ready in this browser.",
  downloadable: "Chrome can download Gemini Nano for this page.",
  downloading: "Chrome is downloading Gemini Nano…",
  unavailable: "Gemini Nano isn't available in this browser; only the local rules run on the device.",
};

const STAGE_WORD: Record<Check["stage"], string> = {
  FILTERED: "not a claim",
  GATEKEEPING: "reading",
  NO_CLAIM: "no checkable claim",
  NEEDS_MODEL: "not checked, no on-device model",
  WITHHELD: "withheld for personal data",
  VERIFYING: "checking with Google Search",
  CLOUD_UNAVAILABLE: "cloud check unavailable",
  OFFLINE: "offline",
  NO_PROJECT: "no project connected",
  DONE: "checked",
  FAILED: "not checked",
};

/** How often the status is asked again while Chrome downloads its model. */
export const STATUS_POLL_MS = 3_000;

/** Forgets the stored project only when it is this one, so another tab's project stays. */
function clearIfStored(project: WebProject): void {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    const stored = raw ? parseStored(raw) : null;
    if (stored !== null && sameProject(stored, project)) clearProject();
  } catch {
    // storage not available: nothing stored
  }
}

const defaultModels = (project: WebProject | null, setup: SetupRecorder): DemoModels => new FirebaseModelSource(project, setup);
const defaultReload = () => window.location.reload();

interface Engine {
  project: WebProject | null;
  models: DemoModels;
  pipeline: WebPipeline;
}

const EMPTY: PipelineSnapshot = {
  checks: [],
  counts: { processed: 0, filtered: 0, withheld: 0, readOnDevice: 0, readInCloud: 0, rawBytes: 0, checked: 0 },
};
const noSubscribe = () => () => {};
const emptySnapshot = () => EMPTY;

/** The live demo: the same pipeline as the Android app, typed sentences instead of speech. */
export function DemoSection({
  createModels = defaultModels,
  status = onDeviceStatus,
  demoGapMs = DemoScript.lineGapMs,
  reload = defaultReload,
}: DemoProps) {
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
  const [engine, setEngine] = useState<Engine | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  // The project now connected; a pipeline built for an earlier one never reaches the cloud.
  const projectRef = useRef(project);
  projectRef.current = project;
  const statusRef = useRef(status);
  statusRef.current = status;

  // In memory only; kept across project changes so the record of what left stays complete.
  const ledger = useMemo(() => new EgressLedger(), []);

  // A new project means a new Firebase instance and a fresh pipeline. Both are made here and
  // finished in the cleanup, so a disconnected project gets no further request (also when
  // React runs effects twice in development).
  useEffect(() => {
    const models = createModels(project, (what, outcome) =>
      ledger.add({
        atMillis: Date.now(),
        kind: "SETUP",
        stage: "setup",
        model: "firebase",
        text: `${what}. No sentence or question of yours is in it.`,
        bytes: 0,
        source: null,
        latencyMs: 0,
        promptVersion: "-",
        outcome,
      }),
    );
    const pipeline = new WebPipeline({
      models,
      ledger,
      cloudProject: () => project !== null && projectRef.current === project,
      deviceStatus: () => statusRef.current(),
    });
    setEngine({ project, models, pipeline });
    return () => {
      pipeline.close();
      void models.dispose?.();
    };
  }, [project, createModels, ledger]);

  const pipeline = engine?.pipeline ?? null;
  const snapshot = useSyncExternalStore(pipeline?.subscribe ?? noSubscribe, pipeline?.getSnapshot ?? emptySnapshot);

  const effectiveMode: PrivacyMode = project === null ? "STRICT" : mode;
  pipeline?.setMode(effectiveMode);
  pipeline?.setSession({
    today,
    region: area.trim() ? { city: area.trim(), area: "", country: "" } : null,
    pinnedTopic: topic.trim() || null,
  });

  // Chrome's model status, asked again when the window gets focus and every few seconds
  // while Chrome downloads the model.
  const [poll, setPoll] = useState(0);
  useEffect(() => {
    let live = true;
    void status().then((s) => live && setDevice(s));
    return () => {
      live = false;
    };
  }, [status, preparing, poll]);
  useEffect(() => {
    const again = () => setPoll((n) => n + 1);
    window.addEventListener("focus", again);
    return () => window.removeEventListener("focus", again);
  }, []);
  useEffect(() => {
    if (device !== "downloading") return;
    const timer = setInterval(() => setPoll((n) => n + 1), STATUS_POLL_MS);
    return () => clearInterval(timer);
  }, [device]);

  const stopDemo = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setDemoRunning(false);
  };
  useEffect(() => stopDemo, [pipeline]);

  const runDemo = () => {
    if (pipeline === null) return;
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
    if (pipeline?.submit(text) != null) setText("");
  };

  const connect = (p: WebProject, remember: boolean): string | null => {
    // App Check keeps a token in IndexedDB, so a site key needs the visitor's consent to store.
    if (p.recaptchaSiteKey && !remember) return "A reCAPTCHA site key needs “Remember on this device”.";
    if (remember) {
      const saved = saveProject(p);
      // Without storage there is no remembered project, and so no consent for App Check's token.
      if (!saved && p.recaptchaSiteKey) {
        return "This browser's storage is not available, so the project can't be remembered and App Check stays off. Connect without the site key.";
      }
      stopDemo();
      setRemembered(saved);
    } else {
      stopDemo();
      // Only this tab's own remembered project is forgotten; another tab's stays.
      if (remembered && project !== null) clearIfStored(project);
      setRemembered(false);
    }
    setProject(p);
    return null;
  };
  /**
   * [appCheckStorageInUse]: another tab replaced this project with one that also uses App Check,
   * so the App Check storage now belongs to that project and is not deleted here.
   */
  const disconnect = (appCheckStorageInUse = false) => {
    stopDemo();
    const startedAppCheck = engine?.models.usedAppCheck === true;
    const hadAppCheck = project?.recaptchaSiteKey != null || startedAppCheck;
    pipeline?.close();
    if (remembered && project !== null) clearIfStored(project);
    setProject(null);
    setRemembered(false);
    setMode("STRICT");
    if (!hadAppCheck) return;
    // Started in this tab, App Check holds its database open: a reload always releases it, and
    // the startup cleanup then deletes the storage unless a remembered project with a site key
    // still uses it. Not started here, nothing holds it, so it is deleted right away, unless
    // another tab's project now uses it.
    if (startedAppCheck) {
      if (!appCheckStorageInUse) forgetRecaptchaStorage();
      reload();
    } else if (!appCheckStorageInUse) {
      forgetRecaptchaStorage();
      void forgetFirebaseStorage();
    }
  };

  // Another tab of this site removed the remembered project (its Disconnect, or cleared
  // storage): this tab disconnects too, so it stops using a project the visitor took back.
  const disconnectRef = useRef(disconnect);
  disconnectRef.current = disconnect;
  const rememberedRef = useRef(remembered);
  rememberedRef.current = remembered;
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (!rememberedRef.current || projectRef.current === null) return;
      if (e.key !== null && e.key !== STORAGE_KEY) return;
      // Removed, or replaced by a different project: this tab no longer has the project it remembered.
      const stored = e.key === null || e.newValue === null ? null : parseStored(e.newValue);
      if (stored === null || !sameProject(stored, projectRef.current)) disconnectRef.current(stored?.recaptchaSiteKey != null);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const prepare = async () => {
    const models = engine?.models;
    if (!models?.prepareOnDevice) return;
    setPreparing("Starting the download…");
    try {
      await models.prepareOnDevice((f) => setPreparing(`Downloading… ${Math.round(f * 100)}%`));
      setPreparing(null);
    } catch (e) {
      setPreparing(`Download did not start: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const latest = snapshot.checks[0];
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
          {device === "downloadable" && engine?.models.prepareOnDevice && (
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
          <button type="button" onClick={() => { stopDemo(); pipeline?.clear(); }} className="rounded-full border border-edge px-5 py-2 hover:border-device">
            Clear
          </button>
        </div>
      </form>

      <p className="text-xs text-slate-400" data-testid="counts">
        Processed {counts.processed} · filtered in this browser {counts.filtered} · withheld for personal data {counts.withheld} · read
        in the cloud {counts.readInCloud} ({counts.rawBytes} B) · checked {counts.checked}
      </p>

      <p role="status" className="sr-only" data-testid="latest-status">
        {latest ? `Latest sentence: ${STAGE_WORD[latest.stage]}.` : ""}
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          {snapshot.checks.length === 0 ? (
            <p className="text-sm text-slate-400">No sentences yet.</p>
          ) : (
            snapshot.checks.map((c) => (
              <CheckCard key={c.id} check={c} today={today} context={{ device }} />
            ))
          )}
        </div>
        <LedgerPanel ledger={ledger} />
      </div>
    </section>
  );
}

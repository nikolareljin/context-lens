import type { FirebaseApp } from "firebase/app";
import type { AI, EnhancedGenerateContentResponse, GenerativeModel, LanguageModelCreateOptions } from "firebase/ai";
import { GroundingParser, type ModelReply, type WebSource } from "../domain";
import { ON_DEVICE, describe, type ModelSource, type PrivacyMode, type TextModel } from "../pipeline/pipeline";
import type { WebProject } from "./project";

/** Grounded verifier models, in the order tried; the same as the Android app (FirebaseModels.kt). */
export const VERIFIER_CANDIDATES = ["gemini-3.1-flash-lite", "gemini-3.8-flash"];

/** The cloud model behind the gatekeeper in Balanced mode, used only when Chrome can't run it. */
export const GATEKEEPER_FALLBACK_MODEL = "gemini-3.1-flash-lite";

/** What Chrome reports for its built-in model (the Prompt API's availability()). */
export type OnDeviceStatus = "available" | "downloadable" | "downloading" | "unavailable";

/** Text in and out, English: what the gatekeeper needs from Chrome's model. */
const CREATE_OPTIONS: LanguageModelCreateOptions = {
  expectedInputs: [{ type: "text", languages: ["en"] }],
  expectedOutputs: [{ type: "text", languages: ["en"] }],
};

/**
 * The Firebase app the on-device gatekeeper runs on. It names no project and holds no key:
 * the AI SDK needs some values to build a model, and these only label a local app. Requests
 * on it go to Chrome's model only (ONLY_ON_DEVICE, and a check before each call that the SDK
 * built its Chrome adapter), so nothing from it ever reaches the network.
 */
export const ON_DEVICE_APP_NAME = "contextlens-on-device";
const ON_DEVICE_OPTIONS = { apiKey: "on-device-only", projectId: "on-device-only", appId: "on-device-only" };

/** The visitor's connected project, created only when a cloud call is about to be made. */
export const CLOUD_APP_NAME = "contextlens-cloud";

interface LanguageModelApi {
  availability(options?: LanguageModelCreateOptions): Promise<string>;
}

function languageModel(): LanguageModelApi | null {
  const lm = (globalThis as { LanguageModel?: Partial<LanguageModelApi> }).LanguageModel;
  return lm && typeof lm.availability === "function" ? (lm as LanguageModelApi) : null;
}

/** Chrome's built-in model status; "unavailable" when this browser has no Prompt API. Nothing is sent. */
export async function onDeviceStatus(): Promise<OnDeviceStatus> {
  const lm = languageModel();
  if (lm === null) return "unavailable";
  try {
    const a = await lm.availability(CREATE_OPTIONS);
    return a === "available" || a === "downloadable" || a === "downloading" ? a : "unavailable";
  } catch {
    return "unavailable";
  }
}

type AppSdk = typeof import("firebase/app");
type AiSdk = typeof import("firebase/ai");

/**
 * The Firebase core keeps a daily usage record ("heartbeat") in IndexedDB, keyed by the app
 * id. This page stores nothing of a connected project unless the visitor asks to remember
 * it, so each app gets a heartbeat service that records and sends nothing. The hook is the
 * SDK's internal component API (pinned SDK version; covered by a test).
 */
function silenceHeartbeat(appSdk: AppSdk, app: FirebaseApp): void {
  const add = (appSdk as unknown as { _addOrOverwriteComponent?: (app: FirebaseApp, component: unknown) => void })._addOrOverwriteComponent;
  if (typeof add !== "function") throw new Error("this Firebase SDK version is not supported");
  add(app, {
    name: "heartbeat",
    type: "PRIVATE",
    instanceFactory: () => ({ triggerHeartbeat: async () => {}, getHeartbeatsHeader: async () => "" }),
    multipleInstances: false,
    serviceProps: {},
    instantiationMode: "LAZY",
    onInstanceCreated: null,
  });
}

/** IndexedDB databases the Firebase SDK may have written for a connected project; removed on Disconnect. */
export const FIREBASE_DATABASES = ["firebase-app-check-database", "firebase-heartbeat-database"];

/** Removes what the Firebase SDK may have stored in this browser. */
export function forgetFirebaseStorage(): void {
  try {
    const idb = globalThis.indexedDB;
    if (idb) FIREBASE_DATABASES.forEach((name) => idb.deleteDatabase(name));
  } catch {
    // storage blocked: nothing was stored either
  }
}

/** The SDK is loaded only when a model is first needed, so the landing page stays light. */
async function loadSdk(): Promise<{ app: AppSdk; ai: AiSdk }> {
  const [app, ai] = await Promise.all([import("firebase/app"), import("firebase/ai")]);
  return { app, ai };
}

/** A stable name for the source: ON_DEVICE or IN_CLOUD, as on Android. */
export function sourceLabel(source: string | undefined): string | null {
  if (source === "on_device") return ON_DEVICE;
  if (source === "in_cloud") return "IN_CLOUD";
  return source ?? null;
}

export function toReply(response: EnhancedGenerateContentResponse): ModelReply {
  let text: string | null;
  try {
    text = response.text();
  } catch {
    // blocked prompt or candidate
    text = null;
  }
  const meta = response.candidates?.[0]?.groundingMetadata;
  const sources: WebSource[] = (meta?.groundingChunks ?? [])
    .map((c) => c.web)
    .filter((w): w is NonNullable<typeof w> => w !== undefined)
    .map((w) => ({ uri: w.uri ?? null, title: w.title ?? null, domain: w.domain ?? null }));
  return {
    text,
    source: sourceLabel(response.inferenceSource),
    grounding: meta
      ? GroundingParser.parse(sources, meta.webSearchQueries ?? [], meta.searchEntryPoint?.renderedContent ?? null)
      : null,
  };
}

/** Every app gets its own name, so a new one never meets an app still being deleted. */
let appCount = 0;

/** Records a Firebase setup request (sign-in, App Check) in the ledger. */
export type SetupRecorder = (what: string, outcome: string) => void;

class SdkModel implements TextModel {
  private model: Promise<GenerativeModel> | null = null;

  constructor(
    readonly name: string,
    private readonly build: () => Promise<GenerativeModel>,
    private readonly before: (model: GenerativeModel) => void = () => {},
  ) {}

  async generate(prompt: string): Promise<ModelReply> {
    this.model ??= this.build();
    const model = await this.model;
    this.before(model);
    const result = await model.generateContent(prompt);
    return toReply(result.response);
  }

  /** Forgets the built model; the next call builds it on a fresh app. */
  reset(): void {
    this.model = null;
  }
}

/**
 * The pipeline's models behind Firebase AI Logic. Without a connected project only the
 * on-device gatekeeper exists; the cloud app is created on the first cloud call.
 */
export class FirebaseModelSource implements ModelSource {
  private sdk: Promise<{ app: AppSdk; ai: AiSdk }> | null = null;
  private localApp: FirebaseApp | null = null;
  private cloudApp: FirebaseApp | null = null;
  private cloudAi: Promise<AI> | null = null;
  private preferred: string | null = null;
  private readonly strict: SdkModel;
  private readonly balanced: SdkModel | null;
  private readonly verifierModels: SdkModel[];

  constructor(
    readonly project: WebProject | null,
    private readonly setup: SetupRecorder = () => {},
  ) {
    this.strict = new SdkModel(GATEKEEPER_FALLBACK_MODEL, () => this.onDeviceModel(), assertOnDeviceOnly);
    this.balanced =
      project === null
        ? null
        : new SdkModel(GATEKEEPER_FALLBACK_MODEL, async () => {
            const { ai } = await this.load();
            return ai.getGenerativeModel(await this.cloud(), {
              mode: ai.InferenceMode.PREFER_ON_DEVICE,
              onDeviceParams: { createOptions: CREATE_OPTIONS },
              inCloudParams: { model: GATEKEEPER_FALLBACK_MODEL, generationConfig: { maxOutputTokens: 256, temperature: 0.1 } },
            });
          });
    this.verifierModels =
      project === null
        ? []
        : VERIFIER_CANDIDATES.map(
            (name) =>
              new SdkModel(name, async () => {
                const { ai } = await this.load();
                const lowThinking = !name.includes("lite");
                return ai.getGenerativeModel(await this.cloud(), {
                  mode: ai.InferenceMode.ONLY_IN_CLOUD,
                  inCloudParams: {
                    model: name,
                    tools: [{ googleSearch: {} }],
                    generationConfig: {
                      // Short answers only; thinking tokens count toward the limit, hence the margin.
                      maxOutputTokens: 1024,
                      ...(lowThinking ? { thinkingConfig: { thinkingLevel: ai.ThinkingLevel.LOW } } : {}),
                    },
                  },
                });
              }),
          );
  }

  private load() {
    this.sdk ??= loadSdk();
    return this.sdk;
  }

  private async onDeviceModel(): Promise<GenerativeModel> {
    const { app, ai } = await this.load();
    if (this.localApp === null) {
      this.localApp = app.initializeApp(ON_DEVICE_OPTIONS, { name: `${ON_DEVICE_APP_NAME}-${++appCount}`, automaticDataCollectionEnabled: false });
      silenceHeartbeat(app, this.localApp);
    }
    return ai.getGenerativeModel(ai.getAI(this.localApp), {
      mode: ai.InferenceMode.ONLY_ON_DEVICE,
      onDeviceParams: { createOptions: CREATE_OPTIONS },
    });
  }

  /** The connected project's AI instance; App Check and sign-in are set up first, when configured. */
  private cloud(): Promise<AI> {
    const project = this.project;
    if (project === null) return Promise.reject(new Error("no Firebase project is connected"));
    this.cloudAi ??= (async () => {
      const { app, ai } = await this.load();
      const options = {
        apiKey: project.apiKey,
        projectId: project.projectId,
        appId: project.appId,
        messagingSenderId: project.messagingSenderId,
        ...(project.authDomain ? { authDomain: project.authDomain } : {}),
      };
      this.cloudApp = app.initializeApp(options, { name: `${CLOUD_APP_NAME}-${++appCount}`, automaticDataCollectionEnabled: false });
      silenceHeartbeat(app, this.cloudApp);
      if (project.recaptchaSiteKey) {
        const appCheck = await import("firebase/app-check");
        appCheck.initializeAppCheck(this.cloudApp, {
          provider: new appCheck.ReCaptchaEnterpriseProvider(project.recaptchaSiteKey),
          isTokenAutoRefreshEnabled: true,
        });
        this.setup("App Check: reCAPTCHA Enterprise token, exchanged with Firebase App Check (the SDK keeps the short-lived token in this browser until Disconnect)", "started");
      }
      if (project.anonymousAuth) {
        const auth = await import("firebase/auth");
        let outcome = "ok";
        try {
          // The session is kept in memory only, never in this browser's storage.
          const session = auth.initializeAuth(this.cloudApp, { persistence: auth.inMemoryPersistence });
          await auth.signInAnonymously(session);
        } catch (e) {
          outcome = describe(e);
        }
        this.setup("Firebase Authentication: anonymous sign-in", outcome);
      }
      return ai.getAI(this.cloudApp, { backend: new ai.GoogleAIBackend() });
    })().catch((e: unknown) => {
      this.cloudAi = null;
      throw e;
    });
    return this.cloudAi;
  }

  gatekeeper(mode: PrivacyMode): TextModel {
    return mode === "BALANCED" && this.balanced !== null ? this.balanced : this.strict;
  }

  verifiers(): TextModel[] {
    const first = this.preferred;
    return [...this.verifierModels].sort((a, b) => (a.name === first ? -1 : b.name === first ? 1 : 0));
  }

  verifierAnswered(name: string): void {
    this.preferred = name;
  }

  async onDeviceReady(): Promise<boolean> {
    return (await onDeviceStatus()) === "available";
  }

  onDeviceName(): string | null {
    return null;
  }

  /**
   * Asks Chrome to download its model; call it from a click, as Chrome requires. Chrome fetches
   * the model itself; no text of the visitor is in that download.
   */
  async prepareOnDevice(progress?: (fraction: number) => void): Promise<void> {
    const model = await this.onDeviceModel();
    await model.initializeDeviceModel(progress);
  }

  /**
   * Deletes the Firebase apps, so a changed project starts from a fresh instance. A later
   * call (React runs effects twice in development) builds new ones.
   */
  async dispose(): Promise<void> {
    const apps = [this.localApp, this.cloudApp].filter((a): a is FirebaseApp => a !== null);
    this.localApp = null;
    this.cloudApp = null;
    this.cloudAi = null;
    [this.strict, this.balanced, ...this.verifierModels].forEach((m) => m?.reset());
    const sdk = this.sdk;
    if (sdk === null || apps.length === 0) return;
    const { app } = await sdk;
    await Promise.all(apps.map((a) => app.deleteApp(a).catch(() => {})));
  }
}

/**
 * The SDK sends an ONLY_ON_DEVICE request to the cloud when it could not build its Chrome
 * adapter (no Prompt API in this browser). This check stops such a call before it is made.
 */
function assertOnDeviceOnly(model: GenerativeModel): void {
  const adapter = (model as unknown as { chromeAdapter?: { mode?: string } }).chromeAdapter;
  if (adapter?.mode !== "only_on_device") {
    throw new Error("Chrome's built-in model is not available; nothing was sent");
  }
}

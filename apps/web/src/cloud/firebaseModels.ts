import type { FirebaseApp } from "@firebase/app";
import type { AI, EnhancedGenerateContentResponse, GenerativeModel, LanguageModelCreateOptions } from "@firebase/ai";
import { GroundingParser, type ModelReply, type WebSource } from "../domain";
import { ON_DEVICE, describe, type ModelSource, type PrivacyMode, type TextModel } from "../pipeline/pipeline";
import type { WebProject } from "./project";

/** Grounded verifier models, in the order tried; the same as the Android app (FirebaseModels.kt). */
export const VERIFIER_CANDIDATES = ["gemini-3.1-flash-lite", "gemini-3.8-flash"];

/** The cloud model behind the gatekeeper in Balanced mode, used only when Chrome can't run it. */
export const GATEKEEPER_FALLBACK_MODEL = "gemini-3.1-flash-lite";

/** What Chrome reports for its built-in model (the Prompt API's availability()). */
export type OnDeviceStatus = "available" | "downloadable" | "downloading" | "unavailable";

/**
 * Text in and out, English: what the gatekeeper needs from Chrome's model. Android also sets an
 * output limit (256) and temperature (0.1) on the device; Chrome's Prompt API, as the SDK exposes
 * it, takes neither, so Chrome's defaults apply.
 */
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

type AppSdk = typeof import("@firebase/app");
type AiSdk = typeof import("@firebase/ai");

interface HeartbeatService {
  triggerHeartbeat(): Promise<void>;
  getHeartbeatsHeader(): Promise<string>;
}

interface ComponentContainer {
  getProvider(name: string): { getImmediate(options: { optional: true }): unknown };
}

/**
 * The Firebase core keeps a daily usage record ("heartbeat") in IndexedDB, keyed by the app
 * id. This page stores nothing of a connected project unless the visitor asks to remember
 * it, so each app gets a heartbeat service that records and sends nothing. The hook is the
 * SDK's internal component API (pinned SDK version); the check afterwards makes sure the app
 * really uses the silent service under the "heartbeat" name, and throws otherwise.
 */
export function silenceHeartbeat(appSdk: AppSdk, app: FirebaseApp): void {
  const add = (appSdk as unknown as { _addOrOverwriteComponent?: (app: FirebaseApp, component: unknown) => void })
    ._addOrOverwriteComponent;
  if (typeof add !== "function") throw new Error("this Firebase SDK version is not supported");
  const silent: HeartbeatService = { triggerHeartbeat: async () => {}, getHeartbeatsHeader: async () => "" };
  add(app, {
    name: "heartbeat",
    type: "PRIVATE",
    instanceFactory: () => silent,
    multipleInstances: false,
    serviceProps: {},
    instantiationMode: "LAZY",
    onInstanceCreated: null,
  });
  const container = (app as unknown as { container?: ComponentContainer }).container;
  if (typeof container?.getProvider !== "function") throw new Error("this Firebase SDK version is not supported");
  if (container.getProvider("heartbeat").getImmediate({ optional: true }) !== silent) {
    throw new Error("this Firebase SDK version is not supported");
  }
}

/** IndexedDB databases the Firebase SDK may write: App Check's token and the heartbeat record. */
export const FIREBASE_DATABASES = ["firebase-app-check-database", "firebase-heartbeat-database"];

export type ForgetResult = "deleted" | "blocked" | "failed" | "none";

/**
 * Deletes the Firebase SDK's IndexedDB databases. It runs at startup, before the SDK loads,
 * when no project is remembered: an open connection in this tab would block it. "blocked"
 * means another tab of this site still has one open; the deletion then finishes when it closes.
 */
export async function forgetFirebaseStorage(idb: IDBFactory | undefined = globalThis.indexedDB): Promise<ForgetResult> {
  if (!idb) return "none";
  const one = (name: string) =>
    new Promise<ForgetResult>((resolve) => {
      try {
        const request = idb.deleteDatabase(name);
        request.onsuccess = () => resolve("deleted");
        request.onerror = () => resolve("failed");
        request.onblocked = () => resolve("blocked");
      } catch {
        resolve("failed");
      }
    });
  const results = await Promise.all(FIREBASE_DATABASES.map(one));
  return results.find((r) => r !== "deleted") ?? "deleted";
}

/** localStorage keys reCAPTCHA Enterprise writes for App Check. */
export const RECAPTCHA_STORAGE_KEYS = ["_grecaptcha"];

type KeyStore = Pick<Storage, "removeItem">;

/** Removes reCAPTCHA's own entries from this browser's localStorage. */
export function forgetRecaptchaStorage(store: KeyStore | null = defaultStore()): void {
  try {
    RECAPTCHA_STORAGE_KEYS.forEach((key) => store?.removeItem(key));
  } catch {
    // storage blocked: nothing was stored either
  }
}

function defaultStore(): KeyStore | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

let storageReady: Promise<unknown> = Promise.resolve();

/**
 * Cleans up at startup when no project is remembered: the Firebase SDK's databases and
 * reCAPTCHA's localStorage entries. The SDK loads only after the cleanup has finished or was
 * reported blocked, so it never holds the databases open first.
 */
export function prepareBrowserStorage(remembered: boolean, idb?: IDBFactory, store?: KeyStore | null): Promise<ForgetResult> {
  if (!remembered) forgetRecaptchaStorage(store === undefined ? defaultStore() : store);
  const run = remembered ? Promise.resolve<ForgetResult>("none") : forgetFirebaseStorage(idb);
  storageReady = run;
  return run;
}

/** The SDK is loaded only when a model is first needed, so the landing page stays light. */
async function loadSdk(): Promise<{ app: AppSdk; ai: AiSdk }> {
  await storageReady;
  const [app, ai] = await Promise.all([import("@firebase/app"), import("@firebase/ai")]);
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

const DISCONNECTED = "this project was disconnected; nothing was sent";

class SdkModel implements TextModel {
  private model: Promise<GenerativeModel> | null = null;

  constructor(
    readonly name: string,
    private readonly build: () => Promise<GenerativeModel>,
    private readonly live: () => boolean,
    private readonly before: (model: GenerativeModel) => void = () => {},
  ) {}

  async generate(prompt: string, signal?: AbortSignal): Promise<ModelReply> {
    if (!this.live()) throw new Error(DISCONNECTED);
    this.model ??= this.build().catch((e: unknown) => {
      this.model = null;
      throw e;
    });
    const model = await this.model;
    // Disconnected or cancelled while the SDK was loading: stop before anything is sent.
    if (!this.live()) throw new Error(DISCONNECTED);
    signal?.throwIfAborted();
    this.before(model);
    const result = await model.generateContent(prompt, signal ? { signal } : undefined);
    return toReply(result.response);
  }
}

/**
 * The pipeline's models behind Firebase AI Logic. Without a connected project only the
 * on-device gatekeeper exists; the cloud app is created on the first cloud call. After
 * dispose() the source is finished: no model call and no new Firebase app.
 */
export class FirebaseModelSource implements ModelSource {
  private sdk: Promise<{ app: AppSdk; ai: AiSdk }> | null = null;
  private localApp: FirebaseApp | null = null;
  private localAppReady: Promise<FirebaseApp> | null = null;
  private cloudApp: FirebaseApp | null = null;
  private cloudAi: Promise<AI> | null = null;
  private preferred: string | null = null;
  private disposed = false;
  private appCheckUsed = false;
  private readonly strict: SdkModel;
  private readonly balanced: SdkModel | null;
  private readonly verifierModels: SdkModel[];

  constructor(
    readonly project: WebProject | null,
    private readonly setup: SetupRecorder = () => {},
  ) {
    const live = () => !this.disposed;
    this.strict = new SdkModel(GATEKEEPER_FALLBACK_MODEL, () => this.onDeviceModel(), live, assertOnDeviceOnly);
    this.balanced =
      project === null
        ? null
        : new SdkModel(
            GATEKEEPER_FALLBACK_MODEL,
            async () => {
              const { ai } = await this.load();
              return ai.getGenerativeModel(await this.cloud(), {
                mode: ai.InferenceMode.PREFER_ON_DEVICE,
                onDeviceParams: { createOptions: CREATE_OPTIONS },
                // As on Android: the cloud fallback sets only the output limit.
                inCloudParams: { model: GATEKEEPER_FALLBACK_MODEL, generationConfig: { maxOutputTokens: 256 } },
              });
            },
            live,
          );
    this.verifierModels =
      project === null
        ? []
        : VERIFIER_CANDIDATES.map(
            (name) =>
              new SdkModel(
                name,
                async () => {
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
                },
                live,
              ),
          );
  }

  /** True once App Check was set up: its token stays in IndexedDB until the page reloads and cleans up. */
  get usedAppCheck(): boolean {
    return this.appCheckUsed;
  }

  private async load(): Promise<{ app: AppSdk; ai: AiSdk }> {
    if (this.disposed) throw new Error(DISCONNECTED);
    this.sdk ??= loadSdk();
    const sdk = await this.sdk;
    if (this.disposed) throw new Error(DISCONNECTED);
    return sdk;
  }

  /** A new app with the silent heartbeat, or none: it is deleted again when silencing fails. */
  private async newApp(appSdk: AppSdk, options: Record<string, string>, name: string): Promise<FirebaseApp> {
    const created = appSdk.initializeApp(options, { name: `${name}-${++appCount}`, automaticDataCollectionEnabled: false });
    try {
      silenceHeartbeat(appSdk, created);
    } catch (e) {
      await appSdk.deleteApp(created).catch(() => {});
      throw e;
    }
    return created;
  }

  /** The on-device app, made once even when two calls ask at the same time. */
  private onDeviceApp(appSdk: AppSdk): Promise<FirebaseApp> {
    this.localAppReady ??= (async () => {
      const created = await this.newApp(appSdk, ON_DEVICE_OPTIONS, ON_DEVICE_APP_NAME);
      if (this.disposed) {
        await appSdk.deleteApp(created).catch(() => {});
        throw new Error(DISCONNECTED);
      }
      this.localApp = created;
      return created;
    })().catch((e: unknown) => {
      this.localAppReady = null;
      throw e;
    });
    return this.localAppReady;
  }

  private async onDeviceModel(): Promise<GenerativeModel> {
    const { app, ai } = await this.load();
    const local = await this.onDeviceApp(app);
    return ai.getGenerativeModel(ai.getAI(local), {
      mode: ai.InferenceMode.ONLY_ON_DEVICE,
      onDeviceParams: { createOptions: CREATE_OPTIONS },
    });
  }

  /**
   * The connected project's AI instance, made on the first cloud call (in Balanced, the first
   * gatekeeper call). App Check and sign-in are set up first, when configured.
   */
  private cloud(): Promise<AI> {
    const project = this.project;
    if (project === null) return Promise.reject(new Error("no Firebase project is connected"));
    if (this.disposed) return Promise.reject(new Error(DISCONNECTED));
    this.cloudAi ??= (async () => {
      const { app, ai } = await this.load();
      const options = {
        apiKey: project.apiKey,
        projectId: project.projectId,
        appId: project.appId,
        messagingSenderId: project.messagingSenderId,
        ...(project.authDomain ? { authDomain: project.authDomain } : {}),
      };
      const created = await this.newApp(app, options, CLOUD_APP_NAME);
      try {
        if (project.recaptchaSiteKey) {
          const appCheck = await import("@firebase/app-check");
          if (this.disposed) throw new Error(DISCONNECTED);
          appCheck.initializeAppCheck(created, {
            provider: new appCheck.ReCaptchaEnterpriseProvider(project.recaptchaSiteKey),
            // No background refresh: a token is fetched only for a cloud call the ledger lists.
            isTokenAutoRefreshEnabled: false,
          });
          this.appCheckUsed = true;
          this.setup(
            "App Check set up (reCAPTCHA Enterprise). This entry stands for it: from now on the page gets App Check tokens (reCAPTCHA in this page, exchanged with Firebase App Check) for its cloud calls; those token requests carry none of your text and are not listed one by one. The SDK keeps the token in this browser (this project is remembered)",
            "on",
          );
        }
        if (project.anonymousAuth) {
          const auth = await import("@firebase/auth");
          if (this.disposed) throw new Error(DISCONNECTED);
          let outcome = "ok";
          try {
            // The session is kept in memory only, never in this browser's storage.
            const session = auth.initializeAuth(created, { persistence: auth.inMemoryPersistence });
            await auth.signInAnonymously(session);
          } catch (e) {
            outcome = describe(e);
          }
          this.setup(
            "Firebase Authentication: anonymous sign-in, kept in memory only. This entry stands for it: later token refreshes carry none of your text and are not listed one by one",
            outcome,
          );
        }
        if (this.disposed) throw new Error(DISCONNECTED);
      } catch (e) {
        // A half-built app is never left behind.
        await app.deleteApp(created).catch(() => {});
        throw e;
      }
      this.cloudApp = created;
      return ai.getAI(created, { backend: new ai.GoogleAIBackend() });
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

  /** Finishes this source: no more model calls and no new app; its Firebase apps are deleted. */
  async dispose(): Promise<void> {
    this.disposed = true;
    const apps = [this.localApp, this.cloudApp].filter((a): a is FirebaseApp => a !== null);
    this.localApp = null;
    this.localAppReady = null;
    this.cloudApp = null;
    this.cloudAi = null;
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

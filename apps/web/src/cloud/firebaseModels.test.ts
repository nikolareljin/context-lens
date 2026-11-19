import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoScript } from "../pipeline/demoScript";
import { WebPipeline } from "../pipeline/pipeline";
import { CLEAN_QUESTION, GATE_CLAIM, fakeProject } from "../test/fakes";
import { STORAGE_KEY } from "./project";
import { deleteApp, getApps, initializeApp } from "@firebase/app";
import * as appSdk from "@firebase/app";
import {
  FIREBASE_DATABASES,
  FirebaseModelSource,
  forgetFirebaseStorage,
  onDeviceStatus,
  prepareBrowserStorage,
  startupStorageCleanup,
  RECAPTCHA_STORAGE_KEYS,
  silenceHeartbeat,
  sourceLabel,
} from "./firebaseModels";

/**
 * These tests run the real Firebase JS SDK. Every way a page can reach the network is a spy,
 * and Chrome's Prompt API (LanguageModel) is a fake that answers like Gemini Nano.
 */
const net = {
  fetch: vi.fn(async (_url?: unknown, _init?: RequestInit): Promise<Response> => {
    throw new Error("network is off in this test");
  }),
  beacon: vi.fn(() => false),
  xhr: vi.fn(),
  socket: vi.fn(),
};

function fakeLanguageModel(availability = "available") {
  const prompt = vi.fn(async () => GATE_CLAIM);
  const api = {
    availability: vi.fn(async () => availability),
    create: vi.fn(async () => ({ prompt, promptStreaming: vi.fn(), destroy: vi.fn() })),
  };
  vi.stubGlobal("LanguageModel", api);
  return { api, prompt };
}

beforeEach(() => {
  vi.stubGlobal("fetch", net.fetch);
  vi.stubGlobal("WebSocket", net.socket);
  Object.defineProperty(navigator, "sendBeacon", { value: net.beacon, configurable: true });
  vi.spyOn(XMLHttpRequest.prototype, "open").mockImplementation(net.xhr);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Object.values(net).forEach((m) => m.mockClear());
});

function expectNothingSent() {
  expect(net.fetch).not.toHaveBeenCalled();
  expect(net.beacon).not.toHaveBeenCalled();
  expect(net.xhr).not.toHaveBeenCalled();
  expect(net.socket).not.toHaveBeenCalled();
}

async function demo(source: FirebaseModelSource, cloud: boolean) {
  const p = new WebPipeline({ models: source, cloudProject: () => cloud });
  p.setSession({ today: "2026-11-19", region: DemoScript.region, pinnedTopic: DemoScript.topic });
  DemoScript.lines.forEach((line) => p.submit(line, true));
  await p.idle();
  return p;
}

describe("without a connected project", () => {
  it("sends nothing: the demo runs on Chrome's model and stops at NO_PROJECT", async () => {
    const { prompt } = fakeLanguageModel();
    const source = new FirebaseModelSource(null);
    const p = await demo(source, false);
    const stages = p.getSnapshot().checks.map((c) => c.stage).reverse();
    expect(stages).toEqual(["FILTERED", "FILTERED", "FILTERED", "FILTERED", "NO_PROJECT", "NO_PROJECT"]);
    const claim = p.getSnapshot().checks.find((c) => c.utterance.startsWith("They raised"))!;
    expect(claim.gate?.source).toBe("ON_DEVICE");
    expect(claim.gate?.result.sanitizedResolvedQuery).toBe(CLEAN_QUESTION);
    expect(prompt).toHaveBeenCalled();
    expect(p.ledger.entries).toEqual([]);
    expectNothingSent();
    await source.dispose();
  });

  it("sends nothing when this browser has no built-in model", async () => {
    vi.stubGlobal("LanguageModel", undefined);
    const source = new FirebaseModelSource(null);
    const p = await demo(source, false);
    const claim = p.getSnapshot().checks.find((c) => c.utterance.startsWith("They raised"))!;
    expect(claim.stage).toBe("NEEDS_MODEL");
    expect(await onDeviceStatus()).toBe("unavailable");
    expectNothingSent();
  });

  it("refuses an on-device call the SDK would route to the cloud", async () => {
    // The Prompt API vanishes after the status check: the SDK builds no Chrome adapter and
    // would send ONLY_ON_DEVICE to the cloud; the guard stops it first.
    fakeLanguageModel();
    const source = new FirebaseModelSource(null);
    expect(await source.onDeviceReady()).toBe(true);
    vi.stubGlobal("LanguageModel", undefined);
    await expect(source.gatekeeper("STRICT").generate("Is the sky blue?")).rejects.toThrow(/nothing was sent/);
    expectNothingSent();
  });

  it("offers no cloud model at all", () => {
    const source = new FirebaseModelSource(null);
    expect(source.verifiers()).toEqual([]);
    expect(source.gatekeeper("BALANCED")).toBe(source.gatekeeper("STRICT"));
  });
});

describe("with a connected project", () => {
  it("in Strict sends only the clean question, and reads the grounded reply", async () => {
    fakeLanguageModel();
    const body = {
      candidates: [
        {
          content: { role: "model", parts: [{ text: "VERDICT: VERIFIED\nSUMMARY: The fare table lists new fares. They began in October." }] },
          finishReason: "STOP",
          groundingMetadata: {
            webSearchQueries: ["springfield bus fares october 2026"],
            groundingChunks: [{ web: { uri: "https://transit.example.com/fares", title: "Fares", domain: "transit.example.com" } }],
            searchEntryPoint: { renderedContent: "<div>chip</div>" },
          },
        },
      ],
    };
    net.fetch.mockImplementation(async () => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));
    const source = new FirebaseModelSource(fakeProject());
    const p = new WebPipeline({ models: source, cloudProject: () => true });
    p.setSession({ today: "2026-11-19", region: DemoScript.region, pinnedTopic: DemoScript.topic });
    p.submit("They raised it again here last month.");
    await p.idle();
    const check = p.getSnapshot().checks[0];
    expect(check.stage).toBe("DONE");
    expect(check.card?.source).toBe("IN_CLOUD");
    expect(check.card?.verdict).toBe("VERIFIED");
    expect(check.card?.grounding.searchEntryPointHtml).toBe("<div>chip</div>");
    // one request: the verifier with the clean question, nothing of the sentence
    expect(net.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = net.fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("gemini-3.1-flash-lite:generateContent");
    expect(String(init.body)).toContain(CLEAN_QUESTION);
    expect(String(init.body)).not.toContain("They raised it again");
    expect(String(init.body)).toContain("googleSearch");
    expect(p.ledger.entries.map((e) => e.kind)).toEqual(["CLEAN_QUERY"]);
    await source.dispose();
  });
  it("stores nothing of the project in the browser", async () => {
    fakeLanguageModel();
    const open = vi.fn(() => {
      throw new Error("IndexedDB used");
    });
    vi.stubGlobal("indexedDB", { open, deleteDatabase: vi.fn() });
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    net.fetch.mockImplementation(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "VERDICT: FALSE" }] } }] }), { status: 200 }));
    const source = new FirebaseModelSource(fakeProject());
    const p = new WebPipeline({ models: source, cloudProject: () => true });
    p.submit("They raised it again here last month.");
    await p.idle();
    expect(net.fetch).toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    await source.dispose();
  });
});

describe("sourceLabel", () => {
  it("names the SDK's sources as Android does", () => {
    expect(sourceLabel("on_device")).toBe("ON_DEVICE");
    expect(sourceLabel("in_cloud")).toBe("IN_CLOUD");
    expect(sourceLabel(undefined)).toBeNull();
  });
});

/** Names of the Firebase apps that exist right now. */
function appNames(): string[] {
  return getApps().map((a) => a.name);
}

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const VERIFIED = { candidates: [{ content: { parts: [{ text: "VERDICT: FALSE\nSUMMARY: No." }] } }] };

describe("disconnecting", () => {
  it("during the gatekeeper: nothing is sent and no app is made for the old project", async () => {
    const { api } = fakeLanguageModel();
    let answer: (text: string) => void = () => {};
    const prompt = vi.fn(() => new Promise<string>((resolve) => (answer = resolve)));
    api.create.mockImplementation(async () => ({ prompt, promptStreaming: vi.fn(), destroy: vi.fn() }));
    net.fetch.mockImplementation(async () => okResponse(VERIFIED));
    const source = new FirebaseModelSource(fakeProject());
    const p = new WebPipeline({ models: source, cloudProject: () => true });
    p.submit("They raised it again here last month.");
    await vi.waitFor(() => expect(prompt).toHaveBeenCalled());
    p.close();
    await source.dispose();
    answer(GATE_CLAIM);
    await p.idle();
    expect(net.fetch).not.toHaveBeenCalled();
    expect(appNames().some((n) => n.startsWith("contextlens-cloud"))).toBe(false);
    expect(p.ledger.entries).toEqual([]);
  });

  it("a disposed source makes no further call and no new app", async () => {
    fakeLanguageModel();
    const source = new FirebaseModelSource(fakeProject());
    await source.dispose();
    const before = appNames();
    await expect(source.verifiers()[0].generate("Claim: x")).rejects.toThrow(/disconnected/);
    await expect(source.gatekeeper("BALANCED").generate("x")).rejects.toThrow(/disconnected/);
    await expect(source.gatekeeper("STRICT").generate("x")).rejects.toThrow(/disconnected/);
    expect(appNames()).toEqual(before);
    expectNothingSent();
  });

  it("an abort signal cancels the cloud request", async () => {
    fakeLanguageModel();
    net.fetch.mockImplementation(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }) as unknown as Promise<Response>,
    );
    const source = new FirebaseModelSource(fakeProject());
    const controller = new AbortController();
    const call = source.verifiers()[0].generate("Claim: x", controller.signal);
    await vi.waitFor(() => expect(net.fetch).toHaveBeenCalledTimes(1));
    controller.abort(new DOMException("cleared", "AbortError"));
    await expect(call).rejects.toBeTruthy();
    await source.dispose();
  });
});

describe("the on-device app", () => {
  it("is made once for calls at the same time, and deleted by dispose()", async () => {
    fakeLanguageModel();
    const count = () => appNames().filter((n) => n.startsWith("contextlens-on-device")).length;
    const before = count();
    const source = new FirebaseModelSource(null);
    const strict = source.gatekeeper("STRICT");
    await Promise.all([strict.generate("Is the sky blue?"), strict.generate("Is grass green?"), source.prepareOnDevice()]);
    expect(count()).toBe(before + 1);
    await source.dispose();
    expect(count()).toBe(before);
    expectNothingSent();
  });
});

describe("browser storage", () => {
  it("anonymous sign-in stays in memory: nothing in local, session or IndexedDB storage", async () => {
    fakeLanguageModel();
    const open = vi.fn(() => {
      throw new Error("IndexedDB used");
    });
    vi.stubGlobal("indexedDB", { open, deleteDatabase: vi.fn() });
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    net.fetch.mockImplementation(async (url: unknown) =>
      String(url).includes("identitytoolkit")
        ? okResponse({ idToken: "springfield-id-token", refreshToken: "springfield-refresh", expiresIn: "3600", localId: "springfield-user", users: [{ localId: "springfield-user" }] })
        : okResponse(VERIFIED),
    );
    const setup = vi.fn();
    const source = new FirebaseModelSource(fakeProject({ anonymousAuth: true }), setup);
    const p = new WebPipeline({ models: source, cloudProject: () => true });
    p.submit("They raised it again here last month.");
    await p.idle();
    expect(setup).toHaveBeenCalledWith(expect.stringMatching(/^Firebase Authentication: anonymous sign-in, kept in memory only\. This entry stands for it/), "ok");
    const urls = net.fetch.mock.calls.map((c) => String((c as unknown[])[0]));
    expect(urls.some((u) => u.includes("identitytoolkit"))).toBe(true);
    expect(urls.some((u) => u.includes(":generateContent"))).toBe(true);
    expect(open).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    await source.dispose();
  });

  it("with an App Check site key, App Check is set up and the source says so", async () => {
    fakeLanguageModel();
    const setup = vi.fn();
    const source = new FirebaseModelSource(fakeProject({ recaptchaSiteKey: "6Lc_springfield_site_key_555" }), setup);
    const p = new WebPipeline({ models: source, cloudProject: () => true, verifyTimeoutMs: 50 });
    p.submit("They raised it again here last month.");
    await p.idle();
    expect(source.usedAppCheck).toBe(true);
    expect(setup.mock.calls[0][0]).toMatch(/^App Check set up \(reCAPTCHA Enterprise\)/);
    p.close();
    await source.dispose();
  });

  it("deletes the Firebase databases at startup unless a project is remembered", async () => {
    const deleted: string[] = [];
    const idb = {
      deleteDatabase: vi.fn((name: string) => {
        deleted.push(name);
        const request = {} as IDBOpenDBRequest;
        setTimeout(() => request.onsuccess?.(new Event("success")));
        return request;
      }),
    } as unknown as IDBFactory;
    expect(await prepareBrowserStorage(true, idb)).toBe("none");
    expect(deleted).toEqual([]);
    expect(await prepareBrowserStorage(false, idb)).toBe("deleted");
    expect(deleted).toEqual(FIREBASE_DATABASES);
  });

  it("removes reCAPTCHA's local storage at startup unless a project is remembered", async () => {
    const idb = { deleteDatabase: () => {
      const request = {} as IDBOpenDBRequest;
      setTimeout(() => request.onsuccess?.(new Event("success")));
      return request;
    } } as unknown as IDBFactory;
    const store = new Map<string, string>([["_grecaptcha", "springfield"], ["other", "kept"]]);
    const keyStore = { removeItem: (k: string) => void store.delete(k) };
    await prepareBrowserStorage(true, idb, keyStore);
    expect(store.has("_grecaptcha")).toBe(true);
    await prepareBrowserStorage(false, idb, keyStore);
    expect(RECAPTCHA_STORAGE_KEYS.some((k) => store.has(k))).toBe(false);
    expect(store.get("other")).toBe("kept");
  });

  it("at startup keeps App Check storage only for a remembered project with a site key", async () => {
    const deleted: string[] = [];
    const idb = {
      deleteDatabase: (name: string) => {
        deleted.push(name);
        const request = {} as IDBOpenDBRequest;
        setTimeout(() => request.onsuccess?.(new Event("success")));
        return request;
      },
    } as unknown as IDBFactory;
    const projects = new Map<string, string>();
    const projectStore = {
      getItem: (k: string) => projects.get(k) ?? null,
      setItem: (k: string, v: string) => void projects.set(k, v),
      removeItem: (k: string) => void projects.delete(k),
    };
    const keys = new Map<string, string>([["_grecaptcha", "springfield"]]);
    const keyStore = { removeItem: (k: string) => void keys.delete(k) };

    // remembered without a site key (another tab's project): App Check storage is deleted
    projects.set(STORAGE_KEY, JSON.stringify(fakeProject()));
    expect(await startupStorageCleanup(projectStore, idb, keyStore)).toBe("deleted");
    expect(deleted).toEqual(FIREBASE_DATABASES);
    expect(keys.has("_grecaptcha")).toBe(false);

    // remembered with a site key: its storage is in use and stays
    deleted.length = 0;
    keys.set("_grecaptcha", "springfield");
    projects.set(STORAGE_KEY, JSON.stringify(fakeProject({ recaptchaSiteKey: "6Lc_springfield_site_key_555" })));
    expect(await startupStorageCleanup(projectStore, idb, keyStore)).toBe("none");
    expect(deleted).toEqual([]);
    expect(keys.has("_grecaptcha")).toBe(true);

    // nothing remembered: deleted
    projects.clear();
    expect(await startupStorageCleanup(projectStore, idb, keyStore)).toBe("deleted");
  });

  it("reports a deletion blocked by another tab, and a failed one", async () => {
    const answer = (event: "onblocked" | "onerror") =>
      ({
        deleteDatabase: () => {
          const request = {} as IDBOpenDBRequest;
          setTimeout(() => (request[event] as ((e: Event) => void) | null)?.(new Event("x")));
          return request;
        },
      }) as unknown as IDBFactory;
    expect(await forgetFirebaseStorage(answer("onblocked"))).toBe("blocked");
    expect(await forgetFirebaseStorage(answer("onerror"))).toBe("failed");
    expect(await forgetFirebaseStorage(undefined)).toBe("none");
  });

  it("refuses an SDK whose heartbeat cannot be silenced", () => {
    const app = initializeApp({ apiKey: "x", projectId: "x", appId: "x" }, "heartbeat-check");
    expect(() => silenceHeartbeat({} as typeof appSdk, app)).toThrow(/not supported/);
    const ignoring = { ...appSdk, _addOrOverwriteComponent: () => {} } as unknown as typeof appSdk;
    expect(() => silenceHeartbeat(ignoring, app)).toThrow(/not supported/);
    expect(() => silenceHeartbeat(appSdk, app)).not.toThrow();
    void deleteApp(app);
  });
});

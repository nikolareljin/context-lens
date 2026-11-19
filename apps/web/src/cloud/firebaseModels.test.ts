import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoScript } from "../pipeline/demoScript";
import { WebPipeline } from "../pipeline/pipeline";
import { CLEAN_QUESTION, GATE_CLAIM, fakeProject } from "../test/fakes";
import { FirebaseModelSource, onDeviceStatus, sourceLabel } from "./firebaseModels";

/**
 * These tests run the real Firebase JS SDK. Every way a page can reach the network is a spy,
 * and Chrome's Prompt API (LanguageModel) is a fake that answers like Gemini Nano.
 */
const net = {
  fetch: vi.fn(async (): Promise<Response> => {
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

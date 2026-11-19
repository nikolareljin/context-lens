import type { Grounding, ModelReply } from "../domain";
import type { WebProject } from "../cloud/project";
import type { ModelSource, PrivacyMode, TextModel } from "../pipeline/pipeline";

/**
 * Made-up project values. The key is assembled at run time, so no file in the repository
 * carries anything shaped like a real key; the project number is a 555 one.
 */
export const FAKE_KEY = "AI" + "za" + "Springfield0555".padEnd(35, "x");
export const FAKE_APP_ID = "1:5550001:web:5ca1ab1e";

export function fakeProject(overrides: Partial<WebProject> = {}): WebProject {
  return {
    projectId: "demo-springfield",
    appId: FAKE_APP_ID,
    apiKey: FAKE_KEY,
    authDomain: "demo-springfield.firebaseapp.com",
    messagingSenderId: "5550001",
    recaptchaSiteKey: null,
    anonymousAuth: false,
    ...overrides,
  };
}

export const CLEAN_QUESTION = "Did Springfield raise city bus fares in October 2026?";

export const GATE_CLAIM = JSON.stringify({
  kind: "world",
  query: CLEAN_QUESTION,
  refs: ["here -> Springfield", "last month -> October 2026"],
});

export const GROUNDING: Grounding = {
  citations: [{ title: "Fare table", uri: "https://transit.example.com/fares", domain: "transit.example.com" }],
  searchQueries: ["springfield bus fare october 2026"],
  searchEntryPointHtml: '<div class="chip"><a href="https://www.google.com/search?q=springfield+bus+fare">springfield bus fare</a></div><script>alert(1)</script>',
};

export class FakeModel implements TextModel {
  readonly prompts: string[] = [];
  readonly signals: (AbortSignal | undefined)[] = [];
  constructor(
    readonly name: string,
    private readonly reply: (prompt: string) => ModelReply | Promise<ModelReply>,
  ) {}
  async generate(prompt: string, signal?: AbortSignal): Promise<ModelReply> {
    this.prompts.push(prompt);
    this.signals.push(signal);
    return this.reply(prompt);
  }
}

/** A reply that arrives only when the test says so, like a model that is still thinking. */
export function held(reply: ModelReply) {
  let release: () => void = () => {};
  const done = new Promise<ModelReply>((resolve) => {
    release = () => resolve(reply);
  });
  return { wait: () => done, release: () => release() };
}

/** A model source with spies on every model, so tests can say which ones were called. */
export class FakeSource implements ModelSource {
  readonly asked: PrivacyMode[] = [];
  onDevice = new FakeModel("on-device", () => ({ text: GATE_CLAIM, source: "ON_DEVICE" }));
  cloudGate = new FakeModel("gemini-cloud-gate", () => ({ text: GATE_CLAIM, source: "IN_CLOUD" }));
  verifier = new FakeModel("gemini-verifier", () => ({
    text: "VERDICT: VERIFIED\nSUMMARY: The fare table lists the new fares. They start in October.",
    source: "IN_CLOUD",
    grounding: GROUNDING,
  }));
  ready = true;
  usedAppCheck = false;
  disposed = false;

  async dispose(): Promise<void> {
    this.disposed = true;
  }

  gatekeeper(mode: PrivacyMode): TextModel {
    this.asked.push(mode);
    return mode === "STRICT" ? this.onDevice : this.cloudGate;
  }
  verifiers(): TextModel[] {
    return [this.verifier];
  }
  async onDeviceReady(): Promise<boolean> {
    return this.ready;
  }
}

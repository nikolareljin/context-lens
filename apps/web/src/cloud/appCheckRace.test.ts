import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeProject } from "../test/fakes";
import { FirebaseModelSource } from "./firebaseModels";

// The App Check module loads only when the test lets it, like a slow network import.
const appCheck = vi.hoisted(() => {
  let release: () => void = () => {};
  const loaded = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    loaded,
    release: () => release(),
    initializeAppCheck: vi.fn(),
    ReCaptchaEnterpriseProvider: vi.fn(),
  };
});
vi.mock("@firebase/app-check", async () => {
  await appCheck.loaded;
  return { initializeAppCheck: appCheck.initializeAppCheck, ReCaptchaEnterpriseProvider: appCheck.ReCaptchaEnterpriseProvider };
});

afterEach(() => vi.unstubAllGlobals());

describe("Disconnect during the first App Check setup", () => {
  it("never starts App Check once the source is disposed", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const source = new FirebaseModelSource(fakeProject({ recaptchaSiteKey: "6Lc_springfield_site_key_555" }));
    const call = source.verifiers()[0].generate("Claim: x");
    // the cloud setup is now waiting for the App Check module
    await new Promise((r) => setTimeout(r, 20));
    void source.dispose();
    expect(source.usedAppCheck).toBe(false);
    appCheck.release();
    await expect(call).rejects.toThrow(/disconnected/);
    expect(appCheck.initializeAppCheck).not.toHaveBeenCalled();
    expect(source.usedAppCheck).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
});

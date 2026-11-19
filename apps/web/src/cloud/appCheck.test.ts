import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeProject } from "../test/fakes";
import { FirebaseModelSource } from "./firebaseModels";

// App Check itself is a stand-in here: the test is about how the page sets it up.
const appCheck = vi.hoisted(() => ({
  initializeAppCheck: vi.fn(),
  ReCaptchaEnterpriseProvider: vi.fn(),
}));
vi.mock("@firebase/app-check", () => appCheck);

afterEach(() => vi.unstubAllGlobals());

describe("App Check setup", () => {
  it("turns off background token refresh, so tokens are fetched only for a cloud call", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    const setup = vi.fn();
    const source = new FirebaseModelSource(fakeProject({ recaptchaSiteKey: "6Lc_springfield_site_key_555" }), setup);
    await source.verifiers()[0].generate("Claim: x").catch(() => {});
    expect(appCheck.initializeAppCheck).toHaveBeenCalledTimes(1);
    expect(appCheck.initializeAppCheck.mock.calls[0][1]).toMatchObject({ isTokenAutoRefreshEnabled: false });
    expect(appCheck.ReCaptchaEnterpriseProvider).toHaveBeenCalledWith("6Lc_springfield_site_key_555");
    expect(setup).toHaveBeenCalledWith(expect.stringMatching(/each cloud call first gets an App Check token/), "on");
    await source.dispose();
  });
});

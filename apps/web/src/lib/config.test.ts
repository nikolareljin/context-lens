import { describe, expect, it } from "vitest";
import { LATEST_APK, readConfig } from "./config";

const full = {
  VITE_FIREBASE_API_KEY: "k",
  VITE_FIREBASE_AUTH_DOMAIN: "p.firebaseapp.com",
  VITE_FIREBASE_PROJECT_ID: "p",
  VITE_FIREBASE_APP_ID: "1:2:web:3",
  VITE_FIREBASE_MESSAGING_SENDER_ID: "2",
};

describe("readConfig", () => {
  it("is not configured without values", () => {
    expect(readConfig({}).firebase).toBeNull();
  });
  it("is not configured when one value is missing or blank", () => {
    expect(readConfig({ ...full, VITE_FIREBASE_APP_ID: "  " }).firebase).toBeNull();
    const { VITE_FIREBASE_PROJECT_ID: _omit, ...partial } = full;
    void _omit;
    expect(readConfig(partial).firebase).toBeNull();
  });
  it("reads a complete configuration", () => {
    const cfg = readConfig({ ...full, VITE_RECAPTCHA_SITE_KEY: "site" });
    expect(cfg.firebase?.projectId).toBe("p");
    expect(cfg.recaptchaSiteKey).toBe("site");
  });
});

describe("download address", () => {
  it("is the fixed asset of the newest release", () => {
    expect(LATEST_APK).toBe("https://github.com/nikolareljin/context-lens/releases/latest/download/context-lens.apk");
  });
});

import { describe, expect, it } from "vitest";
import * as config from "./config";
import { LATEST_APK } from "./config";

describe("download address", () => {
  it("is the fixed asset of the newest release", () => {
    expect(LATEST_APK).toBe("https://github.com/nikolareljin/context-lens/releases/latest/download/context-lens.apk");
  });
});

describe("site configuration", () => {
  it("carries no Firebase values", () => {
    expect(Object.keys(config).sort()).toEqual([
      "DOCS",
      "EXTENSION_APP_CHECK",
      "EXTENSION_ZIP",
      "INSTALL_COMMANDS",
      "LATEST_APK",
      "RECORDED_RUN_URL",
      "RELEASES",
      "REPOSITORY",
      "SITE",
      "WEB_STORE_URL",
      "inExtension",
    ]);
  });
  it("is the site build, not the extension, in tests", () => {
    expect(config.inExtension()).toBe(false);
    expect(config.DOCS).toBe("/context-lens/docs/");
  });
});

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { EXTENSION_ID, EXTENSION_PUBLIC_KEY, buildManifest } from "./manifest";

describe("extension manifest", () => {
  it("carries the release version and asks for the side panel only", () => {
    const m = buildManifest("0.3.0");
    expect(m.version).toBe("0.3.0");
    expect(m.manifest_version).toBe(3);
    expect(m.permissions).toEqual(["sidePanel"]);
    for (const k of ["host_permissions", "optional_permissions", "optional_host_permissions", "content_scripts", "content_security_policy", "externally_connectable", "web_accessible_resources"]) {
      expect(m).not.toHaveProperty(k);
    }
    expect(m.side_panel).toEqual({ default_path: "sidepanel.html" });
    expect(m.background).toEqual({ service_worker: "background.js", type: "module" });
  });

  it("refuses anything but a plain release version", () => {
    for (const v of ["", "v0.3.0", "0.3", "0.3.0-rc1", "01.2.3", "0.3.0\n"]) expect(() => buildManifest(v)).toThrow();
  });

  it("fixes the extension id with its public key", () => {
    const der = Buffer.from(EXTENSION_PUBLIC_KEY, "base64");
    const hex = createHash("sha256").update(der).digest("hex").slice(0, 32);
    const id = [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");
    expect(id).toBe(EXTENSION_ID);
    expect(buildManifest("0.3.0").key).toBe(EXTENSION_PUBLIC_KEY);
  });
});

// The connect page in public/connect: a plain script, run here against its own markup.
import { beforeEach, describe, expect, it } from "vitest";
import html from "../public/connect/index.html?raw";
import script from "../public/connect/connect.js?raw";

// Made-up values in the shape of a real project's; not a working key.
const KEY = "AIza" + "x".repeat(35);
const APP = "1:555000000000:android:0123456789abcdef";

function load(hash: string) {
  window.history.replaceState(null, "", "/context-lens/connect/" + hash);
  const page = new DOMParser().parseFromString(html, "text/html");
  page.querySelectorAll("script").forEach((s) => s.remove());
  document.body.replaceChildren(...Array.from(page.body.childNodes, (n) => document.importNode(n, true)));
  new Function(script)();
  return document.getElementById("open") as HTMLAnchorElement;
}

describe("connect page", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("turns a valid link into the app link and clears it from the address bar", () => {
    const open = load(`#project=my-own-project&app=${encodeURIComponent(APP)}&key=${KEY}`);
    expect(open.hidden).toBe(false);
    const target = new URL(open.href);
    expect(target.protocol).toBe("contextlens:");
    expect(target.searchParams.get("project")).toBe("my-own-project");
    expect(target.searchParams.get("app")).toBe(APP);
    expect(target.searchParams.get("key")).toBe(KEY);
    expect(window.location.hash).toBe("");
    expect(document.getElementById("status")!.textContent).toContain("my-own-project");
  });

  it("offers nothing for a malformed or incomplete link", () => {
    for (const hash of ["", "#project=my-own-project", `#project=X&app=${APP}&key=${KEY}`, `#project=my-own-project&app=${APP}&key=nope`]) {
      const open = load(hash);
      expect(open.hidden).toBe(true);
      expect(open.getAttribute("href")).toBeNull();
    }
  });
});

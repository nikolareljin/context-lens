import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import App from "./App";

afterEach(cleanup);

describe("App", () => {
  it("offers the fixed APK address and the docs", () => {
    render(<App />);
    const download = screen.getByRole("link", { name: "Download the signed APK" });
    expect(download.getAttribute("href")).toBe(
      "https://github.com/nikolareljin/context-lens/releases/latest/download/context-lens.apk",
    );
    expect(screen.getByRole("link", { name: "Download" }).getAttribute("href")).toBe("/context-lens/docs/download/");
    expect(screen.getByRole("link", { name: "Docs" }).getAttribute("href")).toBe("/context-lens/docs/");
    expect(screen.getByRole("link", { name: "Setup" }).getAttribute("href")).toBe("/context-lens/docs/setup/");
    expect(screen.getByRole("link", { name: "Privacy" }).getAttribute("href")).toBe("/context-lens/docs/privacy/");
  });

  it("shows the demo with no project connected", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "Try it in Chrome" })).toBeTruthy();
    expect(screen.getByText(/Not connected: everything stays in this browser/)).toBeTruthy();
    expect(screen.getByText("No request has left this browser.")).toBeTruthy();
  });
});

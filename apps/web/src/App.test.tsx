import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
    expect(screen.getByRole("heading", { name: "Try it live in Chrome" })).toBeTruthy();
    expect(screen.getByText(/Not connected: everything stays in this browser/)).toBeTruthy();
    expect(screen.getByText("No request has left this browser.")).toBeTruthy();
  });

  it("opens the demo run from the top of the page", async () => {
    render(<App />);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Run the demo" }));
    expect(await screen.findByRole("dialog", { name: "Demo run, live in this browser" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows how to install the extension, and no store or recording link before they exist", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "Get the Chrome extension" })).toBeTruthy();
    expect(screen.getByText(/^curl -fsSL https:\/\/raw\.githubusercontent\.com\/nikolareljin\/context-lens\/main\/scripts\/extension-install\.sh \| bash$/)).toBeTruthy();
    expect(screen.getByText(/^irm https:\/\/raw\.githubusercontent\.com\/nikolareljin\/context-lens\/main\/scripts\/extension-install\.ps1 \| iex$/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Download the extension ZIP" }).getAttribute("href")).toBe(
      "https://github.com/nikolareljin/context-lens/releases/latest/download/context-lens-extension.zip",
    );
    expect(screen.queryByRole("link", { name: "Add to Chrome" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Watch the recorded run" })).toBeNull();
    expect(screen.getByRole("link", { name: "Try it live" }).getAttribute("href")).toBe("#try");
  });
});

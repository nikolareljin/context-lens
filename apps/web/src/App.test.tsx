import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import App from "./App";

describe("App", () => {
  it("offers the fixed APK address and the docs", () => {
    render(<App />);
    const download = screen.getByRole("link", { name: "Download the signed APK" });
    expect(download.getAttribute("href")).toBe(
      "https://github.com/nikolareljin/context-lens/releases/latest/download/context-lens.apk",
    );
    expect(screen.getByRole("link", { name: "Docs" }).getAttribute("href")).toBe("/context-lens/docs/");
  });

  it("says the demo is not configured when the build has no Firebase values", () => {
    render(<App />);
    expect(screen.getAllByText(/does not have/).length).toBeGreaterThan(0);
  });
});

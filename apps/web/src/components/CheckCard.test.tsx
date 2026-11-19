import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Check } from "../pipeline/pipeline";
import { CLEAN_QUESTION } from "../test/fakes";
import { CheckCard } from "./CheckCard";

afterEach(cleanup);

function quotaCheck(source: string): Check {
  return {
    id: 1,
    utterance: "They raised it again here last month.",
    atMillis: 0,
    stage: "CLOUD_UNAVAILABLE",
    withheld: [],
    demo: false,
    sentToCloud: source !== "ON_DEVICE",
    note: "429 RESOURCE_EXHAUSTED",
    gate: {
      result: { hasVerifiableClaim: true, sanitizedResolvedQuery: CLEAN_QUESTION, resolvedReferences: [], filterReason: null },
      model: "gemini-3.1-flash-lite",
      source,
      latencyMs: 10,
    },
  };
}

describe("the out-of-quota card", () => {
  it("says the question was written in this browser when the gatekeeper ran on the device", () => {
    render(<CheckCard check={quotaCheck("ON_DEVICE")} today="2026-11-19" />);
    const text = screen.getByTestId("stage-text").textContent ?? "";
    expect(text).toContain("The question was written in this browser");
    expect(screen.getByRole("link", { name: "Search this in your browser" })).toBeTruthy();
  });

  it("says your project's cloud Gemini wrote it after a Balanced fallback", () => {
    render(<CheckCard check={quotaCheck("IN_CLOUD")} today="2026-11-19" />);
    const text = screen.getByTestId("stage-text").textContent ?? "";
    expect(text).toContain("The question was written by your project's cloud Gemini");
    expect(text).not.toContain("in this browser");
  });
});

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

describe("the withheld card", () => {
  function withheld(sentToCloud: boolean): Check {
    return { ...quotaCheck(sentToCloud ? "IN_CLOUD" : "ON_DEVICE"), stage: "WITHHELD", withheld: ["PHONE"], sentToCloud, note: undefined };
  }

  it("says the question was not sent when the gatekeeper ran on the device", () => {
    render(<CheckCard check={withheld(false)} today="2026-11-19" />);
    const text = screen.getByTestId("stage-text").textContent ?? "";
    expect(text).toContain("Question withheld: it still contained personal data (phone). The question was not sent.");
    expect(text).not.toContain("cloud Gemini");
    expect(text).not.toContain("Nothing was sent");
  });

  it("says the sentence was read in the cloud when Balanced sent it there", () => {
    render(<CheckCard check={withheld(true)} today="2026-11-19" />);
    const text = screen.getByTestId("stage-text").textContent ?? "";
    expect(text).toContain("The question was not sent.");
    expect(text).toContain("The sentence itself was read by your project's cloud Gemini (Balanced mode); the ledger lists that request.");
    expect(text).not.toContain("Nothing was sent");
  });
});

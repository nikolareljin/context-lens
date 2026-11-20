import { describe, expect, it } from "vitest";
import type { Check } from "../pipeline/pipeline";
import { stepsOf } from "./DemoRun";

const base: Check = { id: 1, utterance: "They raised it again here last month.", atMillis: 0, stage: "GATEKEEPING", withheld: [], demo: true, sentToCloud: false };
const gate = {
  result: { hasVerifiableClaim: true, sanitizedResolvedQuery: "Did Springfield raise city bus fares in October 2026?", resolvedReferences: ["here -> Springfield"], filterReason: null },
  model: "nano",
  source: "ON_DEVICE",
  latencyMs: 5,
};
const states = (c: Check) => stepsOf(c).map((s) => s.state);

describe("demo run steps", () => {
  it("stops small talk at the local rules", () => {
    expect(states({ ...base, stage: "FILTERED" })).toEqual(["stopped", "waiting", "waiting", "waiting"]);
  });

  it("stops in Strict mode without the on-device model", () => {
    const steps = stepsOf({ ...base, stage: "NEEDS_MODEL" });
    expect(steps.map((s) => s.state)).toEqual(["done", "stopped", "waiting", "waiting"]);
    expect(steps[1].text).toContain("stays here unchecked");
  });

  it("names what the personal-data check found and sends nothing", () => {
    const steps = stepsOf({ ...base, stage: "WITHHELD", gate, withheld: ["NAME", "PHONE"] });
    expect(steps.map((s) => s.state)).toEqual(["done", "done", "stopped", "waiting"]);
    expect(steps[2].text).toBe("Found a name, a phone number: the clean question is withheld and not sent.");
  });

  it("goes all the way for a checked claim, and says where the question was written", () => {
    expect(states({ ...base, stage: "DONE", gate })).toEqual(["done", "done", "done", "done"]);
    expect(stepsOf({ ...base, stage: "DONE", gate }).map((s) => s.where)[1]).toBe("Gemini Nano, in this browser");
    expect(stepsOf({ ...base, stage: "DONE", gate, sentToCloud: true })[1].where).toBe("cloud Gemini (Balanced mode)");
  });

  it("says the sentence went to the cloud in Balanced mode, even when the question is withheld", () => {
    const steps = stepsOf({ ...base, stage: "WITHHELD", gate, withheld: ["NAME"], sentToCloud: true }, "BALANCED");
    expect(steps[1].where).toBe("cloud Gemini (Balanced mode)");
    expect(steps[2].text).toContain("The sentence itself went to cloud Gemini in step 2");
    expect(stepsOf({ ...base, stage: "NO_CLAIM", sentToCloud: true })[1].text).toContain("went to cloud Gemini");
    expect(stepsOf({ ...base, stage: "GATEKEEPING" }, "BALANCED")[1].where).toBe("Gemini Nano, or cloud Gemini (Balanced mode)");
  });

  it("doesn't claim nothing left when the network dropped during the check", () => {
    expect(stepsOf({ ...base, stage: "OFFLINE", gate, note: "network lost" })[3].text).toContain("A request may have left before that");
    expect(stepsOf({ ...base, stage: "OFFLINE", gate })[3].text).toBe("Offline: the clean question was not sent.");
  });

  it("ends at the claim step when the gatekeeper failed", () => {
    const steps = stepsOf({ ...base, stage: "FAILED", note: "The model did not answer in time." });
    expect(steps.map((s) => s.state)).toEqual(["done", "stopped", "waiting", "waiting"]);
    expect(steps[1].text).toBe("The model did not answer in time.");
  });

  it("shows the grounded step as stopped without a project", () => {
    expect(states({ ...base, stage: "NO_PROJECT", gate })).toEqual(["done", "done", "done", "stopped"]);
  });
});

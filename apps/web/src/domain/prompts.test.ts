import { describe, expect, it } from "vitest";
import { PROMPT_FILES, dateHint, describeRange, gatekeeperPrompt, prompts } from "./prompts";
import { preamble } from "./sessionContext";
import { Prompt } from "./types";

const today = "2026-11-14";

describe("prompts", () => {
  it("names months and years in date hints", () => {
    expect(dateHint("They raised it here last month.", today)).toBe('Date hint: "last month" = October 2026');
    expect(dateHint("This company had layoffs last year.", today)).toBe('Date hint: "last year" = 2025');
    expect(dateHint("Water boils at 100 degrees.", today)).toBe("Date hint: none");
    expect(describeRange("2026-11-09", "2026-11-15")).toBe("2026-11-09 to 2026-11-15");
    expect(describeRange("2026-11-09", "2026-11-09")).toBe("2026-11-09");
    expect(describeRange("2026-01-01", "2026-01-31")).toBe("January 2026");
  });

  it("reads the Android prompt files with their placeholders", () => {
    for (const name of ["gatekeeper.v1", "gatekeeper.v2"] as const) {
      for (const key of ["{{context}}", "{{hints}}", "{{utterance}}"]) expect(PROMPT_FILES[name].template, `${name} ${key}`).toContain(key);
    }
    const verify = PROMPT_FILES["verifier.v1"].template;
    expect(verify).toContain("{{query}}");
    const filled = PROMPT_FILES["verifier.v1"].fill({ query: "Q?" });
    expect(filled).not.toContain("{{");
    expect(filled).toMatch(/VERDICT/);
    expect(prompts.gatekeeper.version).toBe("v2");
    expect(prompts.verifier.version).toBe("v1");
  });

  it("carries date, region, topic and recent sentences in the preamble", () => {
    const ctx = { today, region: { city: "Springfield", area: "Shelby", country: "US" }, pinnedTopic: "bus fares", recent: ["a", "b"] };
    expect(preamble(ctx)).toBe("Date: 2026-11-14 (Saturday)\nRegion: Springfield, Shelby, US\nTopic: bus fares\nRecent:\n- a\n- b");
    expect(preamble({ today }).endsWith("Region: unknown\nTopic: none\nRecent: none")).toBe(true);
  });

  it("fills the gatekeeper prompt", () => {
    const template = new Prompt("v1", '{{context}}\n{{hints}}\nSentence: "{{utterance}}" $& $1');
    const out = gatekeeperPrompt(template, { today, region: { city: "Springfield", area: "", country: "" } }, 'He said "up" last month.');
    expect(out).toBe(
      "Date: 2026-11-14 (Saturday)\nRegion: Springfield\nTopic: none\nRecent: none\n" +
        'Date hint: "last month" = October 2026\nSentence: "He said \'up\' last month." $& $1',
    );
  });
});

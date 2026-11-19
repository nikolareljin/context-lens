import { describe, expect, it } from "vitest";
import type { Citation } from "./types";
import { VerdictRules } from "./verdictRules";

const source: Citation = { title: "Example News", uri: "https://example.com/a", domain: "example.com" };

describe("VerdictRules", () => {
  it("takes the verdict from the model only with sources", () => {
    const text = "**VERDICT:** FALSE\nSUMMARY: Harvard was founded in 1636 [1]. The U.S. Senate did not vote on it [2, 3]. A third sentence.";
    const grounded = VerdictRules.card(
      { text, source: "IN_CLOUD", grounding: { citations: [source], searchQueries: ["harvard founded"], searchEntryPointHtml: null } },
      "m",
      800,
    );
    expect(grounded.verdict).toBe("FALSE");
    expect(grounded.summary).toBe("Harvard was founded in 1636. The U.S. Senate did not vote on it.");

    const ungrounded = VerdictRules.card({ text, source: "IN_CLOUD", grounding: null }, "m", 800);
    expect(ungrounded.verdict).toBe("INSUFFICIENT_EVIDENCE");
    expect(ungrounded.modelVerdict).toBe("FALSE");
  });

  it("parses verdicts tolerantly", () => {
    expect(VerdictRules.parseVerdict("Verdict: insufficient evidence\nSummary: none.")).toBe("INSUFFICIENT_EVIDENCE");
    expect(VerdictRules.parseVerdict("VERDICT: NUANCED.")).toBe("NUANCED");
    expect(VerdictRules.parseVerdict("verdict - verified")).toBe("VERIFIED");
    expect(VerdictRules.parseVerdict("It is probably true.")).toBeNull();
    expect(VerdictRules.parseVerdict("VERDICT: MOSTLY TRUE")).toBeNull();
    expect(VerdictRules.parseSummary("It is probably true.")).toBe("It is probably true.");
    const noVerdict = VerdictRules.card(
      { text: "Some text.", source: "IN_CLOUD", grounding: { citations: [source], searchQueries: [], searchEntryPointHtml: null } },
      "m",
      1,
    );
    expect(noVerdict.verdict).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("drops verdict lines from a summary without a label and keeps abbreviations whole", () => {
    expect(VerdictRules.parseSummary("VERDICT: VERIFIED\r\nIt opened in Jan. 2026 downtown. Fares rose. More.")).toBe(
      "It opened in Jan. 2026 downtown. Fares rose.",
    );
    expect(VerdictRules.firstSentences("Dr. Smith agreed. Yes! Done?", 5)).toBe("Dr. Smith agreed. Yes! Done?");
    expect(VerdictRules.parseVerdict("intro\nVERDICT: verified")).toBe("VERIFIED");
    expect(VerdictRules.parseSummary(null)).toBe("");
  });
});

import { describe, expect, it } from "vitest";
import utterances from "../../../../eval/utterances.yaml?raw";
import { isScored, parseEvalSet } from "./evalSet";
import { PiiPostScrubber } from "./piiPostScrubber";
import { PROMPT_FILES, dateHint } from "./prompts";
import { regionLabel } from "./sessionContext";
import { Tier0Filter } from "./tier0Filter";

/**
 * The deterministic half of the evaluation, as the Android unit tests run it: the
 * rules that don't need a model, checked against every sentence in eval/utterances.yaml.
 */
const items = parseEvalSet(utterances);

describe("evaluation set", () => {
  it("parses with unique ids and a test split", () => {
    expect(items.length).toBeGreaterThanOrEqual(70);
    expect(new Set(items.map((it) => it.id)).size).toBe(items.length);
    expect(items.every((it) => it.split === "train" || it.split === "test")).toBe(true);
    expect(items.filter(isScored).length).toBeGreaterThanOrEqual(50);
    expect(items.filter((it) => it.id.startsWith("pii")).every((it) => it.forbid.length > 0)).toBe(true);
    const dx01 = items.find((it) => it.id === "dx01")!;
    expect(dx01.context.today).toBe("2026-11-16");
    expect(dx01.context.region?.city).toBe("Springfield");
    expect(dx01.context.pinnedTopic).toBe("city bus fares");
  });

  it("uses only train sentences as prompt examples", () => {
    const train = new Set(items.filter((it) => it.split === "train").map((it) => it.text));
    for (const name of ["gatekeeper.v1", "gatekeeper.v2"] as const) {
      const examples = Array.from(PROMPT_FILES[name].template.matchAll(/^Sentence: "(.+?)"(?: \(|$)/gm), (m) => m[1]).filter(
        (it) => it !== "{{utterance}}",
      );
      expect(examples.length, name).toBeGreaterThan(0);
      expect(examples.filter((it) => !train.has(it)), name).toEqual([]);
    }
  });

  it("never drops a labelled claim with the local rules", () => {
    const dropped = items.filter((it) => it.claim && Tier0Filter.check(it.text).type === "drop");
    expect(dropped.map((it) => it.id)).toEqual([]);
  });

  it("gives the date hint for every labelled date reference", () => {
    const dateWords = ["last month", "this year", "last year"];
    const misses = items.flatMap((item) =>
      item.refs
        .filter((ref) => dateWords.some((w) => ref.startsWith(`${w} ->`)))
        .filter((ref) => !dateHint(item.text, item.context.today).includes(ref.slice(ref.indexOf("-> ") + 3)))
        .map((ref) => `${item.id}: ${ref}`),
    );
    expect(misses).toEqual([]);
    expect(items.some((it) => it.refs.some((ref) => dateWords.some((w) => ref.startsWith(`${w} ->`))))).toBe(true);
  });

  /** The backstop: if the model copied a planted value into the question, the personal-data check must stop it. */
  it("stops every planted personal value", () => {
    const passed = items.flatMap((item) => {
      const publicNames = [item.context.pinnedTopic, item.context.region ? regionLabel(item.context.region) : null].filter(
        (it): it is string => it != null,
      );
      return item.forbid
        .filter((value) => {
          const query = `Is it true that ${value} is part of this story?`;
          return PiiPostScrubber.findIn(query, item.text, publicNames, item.context.recent ?? []).size === 0;
        })
        .map((value) => `${item.id}: ${value}`);
    });
    expect(passed).toEqual([]);
    expect(items.flatMap((it) => it.forbid).length).toBeGreaterThan(0);
  });
});

import { describe, expect, it } from "vitest";
import { Tier0Filter } from "./tier0Filter";

/** Synthetic sentences in the style of the evaluation set: no real people, numbers or addresses. */
const claims = [
  "The Eiffel Tower is about 330 meters tall.",
  "Rhode Island is the smallest US state by area.",
  "Python was first released in 1991.",
  "They raised it again here last month.",
  "This company had layoffs last year.",
  "Their stock doubled since January.",
  "Didn't Canada legalize cannabis in 2018?",
  "Pluto is still classified as a planet.",
  "Sorry, Rhode Island is the smallest US state.",
  "Call Mark at 555-0134 about the bus fare numbers.",
  "Thanks, the Moon is about 384,000 kilometers away.",
  "Morning traffic doubled this year.",
  "Please note the tax went up.",
];

describe("Tier0Filter", () => {
  it.each(claims)("never drops a claim: %s", (text) => {
    expect(Tier0Filter.check(text)).toEqual({ type: "pass" });
  });

  it.each([
    "Ugh, Mondays.",
    "Morning! Did you sleep okay?",
    "Can you pass me the sugar?",
    "Can you hear me now?",
    "Sorry, I was on mute.",
    "Thanks, see you tomorrow!",
    "Let's grab lunch after this.",
    "",
    "ok",
  ])("drops obvious small talk: %s", (text) => {
    expect(Tier0Filter.check(text).type).toBe("drop");
  });

  it("counts words in any script and keeps the JVM case and space rules", () => {
    expect(Tier0Filter.check("Ça va très bien")).toEqual({ type: "pass" });
    expect(Tier0Filter.check("ok ok")).toEqual({ type: "drop", reason: "too short" });
    expect(Tier0Filter.check("MORNING, how are you")).toEqual({ type: "drop", reason: "small talk" });
    // a no-break space is not JVM whitespace, so this is not "Morning!"
    expect(Tier0Filter.check("Morning ! how are you")).toEqual({ type: "pass" });
  });
});

import { describe, expect, it } from "vitest";
import { DateResolver, isoDate, plusDays } from "./dateResolver";

// Saturday
const today = "2026-11-14";
const range = (text: string) => {
  const m = DateResolver.resolve(text, today);
  return m === null ? null : [m.start, m.end];
};
const day = (d: string) => [d, d];

describe("DateResolver", () => {
  it("resolves relative days", () => {
    expect(range("the vote is today")).toEqual(day(today));
    expect(range("Yesterday the bridge closed")).toEqual(day("2026-11-13"));
    expect(range("opens tomorrow")).toEqual(day("2026-11-15"));
  });

  it("starts weeks on Monday", () => {
    const monday = "2026-11-09";
    expect(range("this week")).toEqual([monday, plusDays(monday, 6)]);
    expect(range("the fare went up last week")).toEqual([plusDays(monday, -7), plusDays(monday, -1)]);
    expect(range("this weekend")).toBeNull();
  });

  it("resolves months and years", () => {
    expect(range("last month")).toEqual(["2026-10-01", "2026-10-31"]);
    expect(range("last year")).toEqual(["2025-01-01", "2025-12-31"]);
  });

  it("takes a weekday as the most recent one before today", () => {
    expect(range("on Monday the council voted")).toEqual(day("2026-11-09"));
    // today is Saturday: "Saturday" means a week ago
    expect(range("last saturday")).toEqual(day("2026-11-07"));
    expect(DateResolver.resolve("on Monday it rained", today)?.phrase).toBe("on Monday");
  });

  it("looks at the right week for next and this", () => {
    // today is Saturday Nov 14; this week runs Nov 9-15
    expect(range("next Monday the vote")).toEqual(day("2026-11-16"));
    expect(range("this coming Friday")).toEqual(day("2026-11-20"));
    expect(range("this Friday")).toEqual(day("2026-11-13"));
    expect(range("this Sunday")).toEqual(day("2026-11-15"));
    expect(range("last  Monday")).toEqual(day("2026-11-09"));
    expect(range("on Mondays it is closed")).toBeNull();
  });

  it("gives null without a date", () => {
    expect(DateResolver.resolve("the bridge is closed", today)).toBeNull();
  });

  it("crosses month, year and leap-day edges", () => {
    expect(DateResolver.resolve("last month", "2027-01-16")).toMatchObject({ start: "2026-12-01", end: "2026-12-31" });
    expect(DateResolver.resolve("this month", "2028-02-10")).toMatchObject({ start: "2028-02-01", end: "2028-02-29" });
    expect(DateResolver.resolve("last month", "2026-03-31")).toMatchObject({ start: "2026-02-01", end: "2026-02-28" });
    expect(DateResolver.resolve("next week", "2026-12-30")).toMatchObject({ start: "2027-01-04", end: "2027-01-10" });
    expect(DateResolver.resolve("yesterday", "2026-01-01")).toMatchObject({ start: "2025-12-31" });
    expect(DateResolver.resolve("this past Sunday", "2026-11-16")).toMatchObject({ phrase: "this past Sunday", start: "2026-11-15" });
    expect(isoDate(2026, 13, 1)).toBe("2027-01-01");
  });

  it("matches whole words only, the JVM way", () => {
    // a letter in another script next to the word is still part of the word
    expect(DateResolver.resolve("todayé", today)).toBeNull();
    expect(DateResolver.resolve("é today", today)?.phrase).toBe("today");
  });
});

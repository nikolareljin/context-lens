import { dayOfWeek, type IsoDate } from "./dateResolver";
import { ktIsBlank } from "./jvmRegex";

/** A coarse area: the nearest larger city, never coordinates. */
export interface Region {
  city: string;
  area: string;
  country: string;
}

export function regionLabel(region: Region): string {
  return [region.city, region.area, region.country].filter((it) => !ktIsBlank(it)).join(", ");
}

/**
 * What the checker knows about the moment, kept in memory only and cleared with
 * the session. It gives a sentence like "the bus fare went up last week" the
 * place, date and topic it needs to become a checkable question.
 */
export interface SessionContext {
  today: IsoDate;
  region?: Region | null;
  pinnedTopic?: string | null;
  /** The latest utterances, oldest first. */
  recent?: string[];
}

const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** The context block for the gatekeeper prompt. */
export function preamble(context: SessionContext): string {
  const weekday = WEEKDAY_NAMES[dayOfWeek(context.today) - 1];
  const recent = context.recent ?? [];
  return [
    `Date: ${context.today} (${weekday})`,
    `Region: ${context.region ? regionLabel(context.region) : "unknown"}`,
    `Topic: ${context.pinnedTopic ?? "none"}`,
    recent.length === 0 ? "Recent: none" : `Recent:${recent.map((it) => `\n- ${it}`).join("")}`,
  ].join("\n");
}

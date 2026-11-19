import { B, S, ci, re } from "./jvmRegex";

/** A calendar date without time or zone, written YYYY-MM-DD (as java.time.LocalDate prints it). */
export type IsoDate = string;

/** A relative date in speech, resolved to an inclusive range. */
export interface DateMention {
  phrase: string;
  start: IsoDate;
  end: IsoDate;
}

// Dates are computed on UTC midnights, so no time zone or daylight-saving change moves them.
function at(year: number, month: number, day: number): Date {
  const d = new Date(0);
  d.setUTCFullYear(year, month - 1, day);
  return d;
}

function iso(d: Date): IsoDate {
  const pad = (n: number, w: number) => String(n).padStart(w, "0");
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1, 2)}-${pad(d.getUTCDate(), 2)}`;
}

export function parseIsoDate(text: IsoDate): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (m === null) throw new Error(`not a date: ${text}`);
  const d = at(Number(m[1]), Number(m[2]), Number(m[3]));
  if (iso(d) !== text) throw new Error(`not a date: ${text}`);
  return d;
}

export function isoDate(year: number, month: number, day: number): IsoDate {
  return iso(at(year, month, day));
}

/** The viewer's local calendar date. */
export function localToday(now: Date = new Date()): IsoDate {
  return isoDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function plusDays(date: IsoDate, days: number): IsoDate {
  const d = parseIsoDate(date);
  return isoDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate() + days);
}

/** 1 = Monday ... 7 = Sunday, as java.time.DayOfWeek. */
export function dayOfWeek(date: IsoDate): number {
  return ((parseIsoDate(date).getUTCDay() + 6) % 7) + 1;
}

export function lengthOfMonth(year: number, month: number): number {
  return at(year, month + 1, 0).getUTCDate();
}

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

const pattern = re(
  `${B}(${ci("today|tonight|yesterday|tomorrow|this week|last week|next week|this month|last month|this year|last year")}|` +
    `(?:(?:${ci("last|this past|next|this coming|this|on")})${S}+)?(?:${ci(WEEKDAYS.join("|"))}))${B}`,
);

const words = re(`${S}+`);

/**
 * Resolves relative date phrases ("yesterday", "last week", "on Monday") against
 * today, so a verifier can search for the right period. Weeks start on Monday.
 * "next Friday" looks ahead, "this Friday" means the one in the current week, and
 * any other weekday mention means the most recent one before today.
 * Only the first mention is returned; phrases that need more context are ignored.
 */
export function resolve(text: string, today: IsoDate): DateMention | null {
  // NFKC ("ſunday" → "sunday", "laﬆ" → "last") and every kind of space as one plain space,
  // as the app does, so a phrase is found and read the same way in both.
  const match = pattern.exec(text.normalize("NFKC").split(words).join(" "));
  if (match === null) return null;
  const phrase = match[0];
  const p = phrase.toLowerCase();
  const t = parseIsoDate(today);
  const year = t.getUTCFullYear();
  const month = t.getUTCMonth() + 1;
  const dow = dayOfWeek(today);
  const weekStart = plusDays(today, 1 - dow);
  const range = (start: IsoDate, end: IsoDate): DateMention => ({ phrase, start, end });
  switch (p) {
    case "today":
    case "tonight":
      return range(today, today);
    case "yesterday":
      return range(plusDays(today, -1), plusDays(today, -1));
    case "tomorrow":
      return range(plusDays(today, 1), plusDays(today, 1));
    case "this week":
      return range(weekStart, plusDays(weekStart, 6));
    case "last week":
      return range(plusDays(weekStart, -7), plusDays(weekStart, -1));
    case "next week":
      return range(plusDays(weekStart, 7), plusDays(weekStart, 13));
    case "this month":
      return range(isoDate(year, month, 1), isoDate(year, month, lengthOfMonth(year, month)));
    case "last month": {
      const [y, m] = month === 1 ? [year - 1, 12] : [year, month - 1];
      return range(isoDate(y, m, 1), isoDate(y, m, lengthOfMonth(y, m)));
    }
    case "this year":
      return range(isoDate(year, 1, 1), isoDate(year, 12, 31));
    case "last year":
      return range(isoDate(year - 1, 1, 1), isoDate(year - 1, 12, 31));
    default: {
      const parts = p.split(" ");
      const day = WEEKDAYS.indexOf(parts[parts.length - 1]) + 1;
      // A phrase the folding could not bring to a plain weekday is not resolved.
      if (day === 0) return null;
      let date: IsoDate;
      switch (parts.slice(0, -1).join(" ")) {
        case "next":
        case "this coming":
          date = plusDays(today, (day - dow + 7) % 7 || 7);
          break;
        case "this":
          date = plusDays(weekStart, day - 1);
          break;
        // "last", "this past", "on" or a bare weekday: the most recent one, today excluded.
        default:
          date = plusDays(today, -((dow - day + 7) % 7 || 7));
      }
      return range(date, date);
    }
  }
}

export const DateResolver = { resolve };

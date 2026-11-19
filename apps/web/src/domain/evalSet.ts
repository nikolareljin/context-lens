import { parse as parseYaml } from "yaml";
import { isoDate, type IsoDate } from "./dateResolver";
import type { SessionContext } from "./sessionContext";

/** One labelled sentence from eval/utterances.yaml. */
export interface EvalItem {
  id: string;
  split: string;
  text: string;
  context: SessionContext;
  claim: boolean;
  refs: string[];
  forbid: string[];
  queryHas: string[];
}

export const isScored = (item: EvalItem) => item.split === "test";

type YamlMap = Record<string, unknown>;

const asMap = (value: unknown): YamlMap =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as YamlMap) : {};

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.map((it) => String(it)) : []);

/** Reads the evaluation set: synthetic sentences with the expected gatekeeper answer. */
export function parseEvalSet(yaml: string): EvalItem[] {
  const root = asMap(parseYaml(yaml));
  const defaults = asMap(root.defaults);
  return (root.items as unknown[]).map((raw) => {
    const m = asMap(raw);
    const ctx = asMap(m.context);
    const setting = (key: string): string | null => {
      const value = ctx[key] ?? defaults[key];
      return value == null ? null : String(value);
    };
    const region = setting("region");
    if (typeof m.claim !== "boolean") throw new Error(`${String(m.id)}: claim is not a boolean`);
    return {
      id: String(m.id),
      split: String(m.split),
      text: String(m.text),
      context: {
        today: month(setting("date") ?? "November 2026"),
        region: region === null ? null : { city: region, area: "", country: "" },
        pinnedTopic: setting("pinned"),
        recent: strings(ctx.rolling),
      },
      claim: m.claim,
      refs: strings(m.refs),
      forbid: strings(m.forbid),
      queryHas: strings(m.query_has),
    };
  });
}

const MONTHS = [
  "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
  "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
];

/** "November 2026" -> the 16th of that month, so "last month" and "this year" are unambiguous. */
export function month(text: string): IsoDate {
  const [name, year] = text.trim().split(/[ \t\n\x0B\f\r]+/);
  const index = MONTHS.indexOf((name ?? "").toUpperCase());
  if (index < 0 || year === undefined || !/^[+-]?\d+$/.test(year)) throw new Error(`not a month: ${text}`);
  return isoDate(Number(year), index + 1, 16);
}

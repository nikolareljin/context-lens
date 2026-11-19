import gatekeeperV1 from "../../../android/app/src/main/assets/prompts/gatekeeper.v1.txt?raw";
import gatekeeperV2 from "../../../android/app/src/main/assets/prompts/gatekeeper.v2.txt?raw";
import verifierV1 from "../../../android/app/src/main/assets/prompts/verifier.v1.txt?raw";
import { isoDate, lengthOfMonth, parseIsoDate, resolve, type IsoDate } from "./dateResolver";
import { preamble, type SessionContext } from "./sessionContext";
import { Prompt } from "./types";

/** The versioned prompts, read from the Android app's assets so both apps ask the same way. */
export const PROMPT_FILES = {
  "gatekeeper.v1": new Prompt("v1", gatekeeperV1),
  "gatekeeper.v2": new Prompt("v2", gatekeeperV2),
  "verifier.v1": new Prompt("v1", verifierV1),
} as const;

/** The versions the Android app uses. */
export const prompts = { gatekeeper: PROMPT_FILES["gatekeeper.v2"], verifier: PROMPT_FILES["verifier.v1"] };

/** The gatekeeper prompt for one sentence; the app and the evaluation use the same one. */
export function gatekeeperPrompt(template: Prompt, context: SessionContext, text: string): string {
  return template.fill({
    context: preamble(context),
    hints: dateHint(text, context.today),
    utterance: text.replaceAll('"', "'"),
  });
}

/** A line for the gatekeeper prompt with the date a phrase like "last month" means. */
export function dateHint(text: string, today: IsoDate): string {
  const m = resolve(text, today);
  if (m === null) return "Date hint: none";
  return `Date hint: "${m.phrase}" = ${describeRange(m.start, m.end)}`;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function describeRange(start: IsoDate, end: IsoDate): string {
  const s = parseIsoDate(start);
  const year = s.getUTCFullYear();
  const month = s.getUTCMonth() + 1;
  if (start === end) return start;
  if (s.getUTCDate() === 1 && end === isoDate(year, month, lengthOfMonth(year, month))) return `${MONTHS[month - 1]} ${year}`;
  if (start === isoDate(year, 1, 1) && end === isoDate(year, 12, 31)) return `${year}`;
  return `${start} to ${end}`;
}

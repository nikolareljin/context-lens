import { S, ci, ktTrim, re } from "./jvmRegex";

/**
 * The deterministic first pass. It drops only sentences that are clearly not
 * claims (very short lines, greetings, thanks, apologies, simple requests), so
 * the model is not woken for them. Words that also begin claims ("Please note the
 * tax went up", "Morning traffic doubled") are not openers. Anything in doubt passes
 * on: a missed claim costs more than one extra model call.
 */
export type Tier0Decision = { type: "pass" } | { type: "drop"; reason: string };

export const MIN_WORDS = 3;

/** Lines this short that start with a small-talk opener and have no number are dropped. */
export const SMALL_TALK_MAX_WORDS = 6;

const word = re("[\\p{L}\\p{N}']+", "g");
const digit = /\d/;

const openers = [
  "hi", "hello", "hey", "good morning", "good afternoon", "good evening", "good night",
  "thanks", "thank you", "sorry", "bye", "goodbye", "see you",
  "can you hear", "can you pass", "could you pass", "let's", "lets",
];

/** "Morning!" greets; "Morning traffic doubled" is a claim. */
const morningGreeting = re(`^${ci("morning")}${S}*[!,.]`);

export function check(text: string): Tier0Decision {
  const words = Array.from(text.toLowerCase().matchAll(word), (m) => m[0]);
  if (words.length < MIN_WORDS) return { type: "drop", reason: "too short" };
  if (digit.test(text) || words.length > SMALL_TALK_MAX_WORDS) return { type: "pass" };
  const joined = words.join(" ");
  const opener = openers.find((it) => joined === it || joined.startsWith(`${it} `));
  return opener !== undefined || morningGreeting.test(ktTrim(text))
    ? { type: "drop", reason: "small talk" }
    : { type: "pass" };
}

export const Tier0Filter = { MIN_WORDS, SMALL_TALK_MAX_WORDS, check };

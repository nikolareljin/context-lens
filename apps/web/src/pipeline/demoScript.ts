import type { Region } from "../domain";

/**
 * The fixed conversation of the Android app (DemoScript.kt), for trying the page without
 * typing. Every line goes through the real pipeline and its card is marked as demo input.
 * The place is fictional, so no real town shows up on screen.
 */
export const DemoScript = {
  region: { city: "Springfield", area: "", country: "" } satisfies Region,
  topic: "city bus fares",
  lines: [
    // Small talk: the local rules drop these, so no model runs and nothing is sent.
    "Morning! Did you sleep okay?",
    "Can you pass the water?",
    "Thanks, that was great.",
    "Sorry, I was on mute.",
    // A claim that needs the place, the date and the topic to make sense.
    "They raised it again here last month.",
    // A sentence with a name and a phone number in it.
    "Call Mark at 555-0134 about the bus fare numbers.",
  ],
  /** Long enough to read each card as it appears. */
  lineGapMs: 2_500,
} as const;

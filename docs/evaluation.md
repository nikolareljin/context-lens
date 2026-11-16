# Evaluation

The gatekeeper (the step that turns a sentence into a clean search question) is measured on a set of 73 made-up sentences in [`eval/utterances.yaml`](https://github.com/nikolareljin/context-lens/blob/main/eval/utterances.yaml): small talk, opinions, checkable claims, sentences that need "here", "they" or "last month" resolved, borderline cases, and sentences with personal data planted in them. The names, numbers and addresses are fictional. 58 sentences are scored; the rest are the source of the prompt's examples.

## What is measured

| Metric | Meaning | Target |
|---|---|---|
| Claim precision and recall | checkable claims found, versus missed or invented | reported |
| References resolved | "here", "last month", "this company" resolved as labelled | reported |
| Personal data left by the model | planted names, numbers or addresses the model copied into a question | reported |
| Personal data that would be sent | of those, the ones the personal-data check would not stop | **0** |
| Median latency | time per sentence on the phone | reported |

## How to run it

- **On a computer:** `./dev eval` runs the parts that need no model against every sentence in the set: the local rules never drop a labelled claim, the date hints match every labelled date reference, and the personal-data check stops every planted value even when it is copied into a question word for word. CI runs the same tests.
- **On a phone:** Diagnostics → **Run evaluation** sends each scored sentence to Gemini Nano with the same prompt as the Listen screen, in Strict mode, so nothing leaves the phone. **Copy results** gives the summary and one line per sentence.

## Results

Results are added here with the phone model, Android version and app version after each on-device run.

# Evaluation

The gatekeeper (the step that turns a sentence into a clean search question) is measured on a set of 73 made-up sentences in [`eval/utterances.yaml`](https://github.com/nikolareljin/context-lens/blob/main/eval/utterances.yaml): small talk, opinions, checkable claims, sentences that need "here", "they" or "last month" resolved, borderline cases, and sentences with personal data planted in them. The names, numbers and addresses are fictional. 58 sentences are scored; the rest are the source of the prompt's examples.

## What is measured

| Metric | Meaning | Target |
|---|---|---|
| Claim precision and recall | checkable claims found, versus missed or invented; a claim the model failed on (timeout, unreadable reply) counts as missed | reported |
| References resolved | "here", "last month", "this company" resolved as labelled | reported |
| Personal data left by the model | planted names, numbers or addresses the model copied into a question | reported |
| Personal data that would be sent | of those, the ones the personal-data check would not stop | **0** |
| Median latency | time per sentence on the phone | reported |

## How to run it

- **On a computer:** `./dev eval` runs the parts that need no model against every sentence in the set: the local rules never drop a labelled claim, the date hints match every labelled date reference, and the personal-data check stops every planted value even when it is copied into a question word for word. CI runs the same tests.
- **On a phone:** Diagnostics → **Run evaluation** sends each scored sentence to Gemini Nano with the same prompt as the Listen screen, in Strict mode, so nothing leaves the phone. Android limits how often one app may call the on-device model, and the run sends sentences back to back, so a call refused for that quota is retried after 5 s and again after 15 s; only the last refusal counts as a failure. The summary lists failure reasons and the ids of claims the model answered "no claim" to (failed calls on claims count in FN but are listed under failures); **Copy results** adds one line per sentence.

## Known limits

The personal-data check is a backstop behind the prompt, not a complete name detector. It finds names after titles and relation words ("Dr. Patel", "my friend Jenna"), before personal verbs ("Jenna Liu told me"), after "Call" or "Tell", and in first.last email addresses. A name written any other way, an address without separators ("jrivera@"), or a two-letter given name that is also an everyday word ("An", "My"), relies on the model leaving it out; the on-device run measures how often it does.

## Results

Results are added here with the phone model, Android version and app version after each on-device run.

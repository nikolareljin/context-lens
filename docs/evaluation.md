# Evaluation

The gatekeeper (the step that turns a sentence into a clean search question) is measured on a set of 77 made-up sentences in [`eval/utterances.yaml`](https://github.com/nikolareljin/context-lens/blob/main/eval/utterances.yaml): small talk, opinions, checkable claims, sentences that need "here", "they" or "last month" resolved, borderline cases, and sentences with personal data planted in them. The names, numbers and addresses are fictional. 58 sentences are scored; the rest are the source of the prompt's examples.

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

### Samsung Galaxy S26 (SM-S942U), Android 17, prompt v2, Nov 16, 2026

On-device model nano-v4-fast, 58 scored sentences, Strict mode, same phone and set as the v1 run below.

| Metric | Prompt v1 | Prompt v2 |
|---|---|---|
| Failed calls | 0 | 0 |
| Claim precision | 96% | 94% |
| Claim recall | 75% (27 found, 1 invented, 9 missed) | **94%** (34 found, 2 invented, 2 missed) |
| References resolved | 5 of 6 | 5 of 6 |
| Expected words in the questions for found claims | 14 of 16 | 14 of 17 |
| Personal data left by the model | 0 | 0 |
| Personal data that would be sent | **0** | **0** |
| Median latency | about 1.8 s | about 1.35 s |

What changed in v2:

- **The model names the kind of sentence; the app decides.** The reply has `kind` (`world`, `small talk`, `request`, `opinion` or `personal`) instead of a true/false claim flag, and a `world` sentence is a claim. In test runs with both fields, the model labelled myths and plain facts `world` and still set the flag to false, so the flag was dropped.
- **Myths, false statements and general knowledge count.** v1 treated "The Great Wall of China is visible from the Moon" or "Bats are blind" as "a statement of fact, not a claim"; v2 says not to judge whether it is true.
- **Questions restate the claim** as a yes/no question with its own numbers and dates, and list every resolved word.
- **New examples** come from four new training sentences (fc15, fc16, dx11, pii11); a unit test checks that every example in a prompt is a training sentence, never a scored one.

Still missed: pii03 and pii04. These are a request and a personal remark with a public fact inside: the EV credit amount in "email me if...", and a toll rate charged to the speaker's card. The model labels them `request` or `personal`. The 2 invented claims in the runs that logged each reply were a weather forecast (bl04) and the speaker's own sales (bl12). The personal-data check still stops what the model leaves in, and in these runs it left nothing.

### Samsung Galaxy S26 (SM-S942U), Android 17, app 0.0.1, Nov 16, 2026

On-device model nano-v4-fast, prompt v1, 58 scored sentences, Strict mode.

| Metric | Result |
|---|---|
| Failed calls | 0 |
| Claim precision | 96% |
| Claim recall | 75% (27 found, 1 invented, 9 missed) |
| References resolved | 5 of 6 |
| Expected words in the questions for found claims | 14 of 16 |
| Personal data left by the model | 0 |
| Personal data that would be sent | **0** |
| Median latency | about 1.8 s |
| Inference source | `ON_DEVICE` for all 58 |

Missed claims: fc05, fc11, fc13, dx06, pii03, pii04, pii10, bl07, ns05. Prompt v2 (above) targets these.

The first run on this phone had 9 calls refused by Android's usage quota for Gemini Nano, because the evaluation sends sentences back to back. The evaluation now waits and retries a refused call, and the summary lists the reason for any call that still fails.

<img class="cl-screen" src="../assets/screen-evaluation.png" alt="Diagnostics evaluation summary on the phone: 58 test sentences, 0 failed, claim precision 96%, recall 75%, references 5 of 6, personal data 0 left and 0 would have been sent, median latency 1804 ms, all on device">

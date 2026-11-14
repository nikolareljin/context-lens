# Evaluation

The gatekeeper is measured on a synthetic set of labelled sentences (small talk, opinions, checkable claims, sentences with "here", "they" and "last month", and sentences with personal data planted in them). No real people, numbers or addresses are used.

| Metric | Meaning | Target |
|---|---|---|
| Claim precision / recall | checkable claims found vs missed or invented | reported |
| Reference accuracy | "here", "last month", "this company" resolved as labelled | reported |
| Personal-data leaks | planted names, numbers or addresses present in a question that would be sent | **0** |
| Median latency on device | Tier 1 time per sentence | reported |

The deterministic parts (local rules, personal-data rules, date resolution) run in CI with `./dev eval`. The Gemini Nano part runs on a phone from the diagnostics screen or with `./dev eval --device`.

Results are added here with the device model, Android version and SDK versions once the first on-device run is done.

# How the hybrid split works

ContextLens uses one SDK, Firebase AI Logic, for both tiers.

```
speech or typed sentence
  → local rules: too short, filler, no claim cues          → dropped on the phone
  → session context: region, date, pinned topic, last three sentences (memory only)
  → Tier 1, Gemini Nano on the device
       Strict:   OnDeviceConfig(mode = ONLY_ON_DEVICE)
       Balanced: OnDeviceConfig(mode = PREFER_ON_DEVICE)
       JSON: hasVerifiableClaim, sanitizedResolvedQuery, resolvedReferences, filterReason
                                                             → no claim: dropped on the phone
  → personal-data rules on the rewritten question           → match: withheld
  → Tier 2, cloud Gemini, Tool.googleSearch()
       receives only sanitizedResolvedQuery
       verdict, two sentences, sources from groundingMetadata
```

## Why two tiers

| | Tier 1 | Tier 2 |
|---|---|---|
| Job | decide, resolve, rewrite | verify with current sources |
| Sees | the raw sentence and the private context | one clean question |
| Runs | on the phone | in the cloud |
| Cost per sentence | no network, no cloud quota | only for checkable claims |

## Telling the truth about where it ran

Each response from Firebase AI Logic carries `inferenceSource` (`ON_DEVICE` or `IN_CLOUD`). The cards, the diagnostics log and the ledger show that value verbatim; the app never infers it from connectivity.

## Rules after the model

- No source in the grounding metadata means the verdict is "insufficient evidence", whatever the model wrote.
- The summary is cut to two sentences.
- Verdicts use an icon and a label as well as a color.
- The Google Search suggestions returned with a grounded answer are shown with the card.

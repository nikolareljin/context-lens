# Privacy firewall

This page describes the design and is updated as features land.

## What stays on the phone

| Data | Where it lives |
|---|---|
| Audio | never stored; the platform's on-device speech recognizer (Android 12+) turns it into text. Without it the microphone stays off, because the regular recognizer may send audio to a server |
| Spoken and typed sentences | memory only, the last three, for resolving "it", "they", "here" |
| Location | only on request ("Set my area"), coarse network position only. The coordinates are turned into the nearest city of 50,000 or more with a GeoNames table bundled in the app, then discarded; the platform geocoder is not used because it sends coordinates to a network service |
| Pinned topic, date | memory only |

## What leaves the phone

Only the rewritten question for a checkable claim, sent to cloud Gemini through Firebase AI Logic, protected by App Check. Before it is sent, deterministic rules look for email addresses, phone numbers, card and account numbers, government ids, street addresses and names from the session; on a match the request is withheld and the card says so.

## The egress ledger

Every request that leaves the phone is recorded on the device: time, model, the exact text sent, its size, the source Firebase AI Logic reported, and the latency. The counters on the main screen are computed from the ledger, so "raw text sent: 0 B" is a measurement. The ledger can be exported as text and is cleared when the app closes.

## Modes

| Mode | Gatekeeper | If Gemini Nano is not available |
|---|---|---|
| Strict (default) | on device only | nothing is sent; simple local rules filter |
| Balanced (opt in) | prefers the device | the sentence and its context go to cloud Gemini, as the app tells you before you turn it on |

## Accounts

The app signs in anonymously so that App Check and per-install limits work. No name, email or contact list is requested.

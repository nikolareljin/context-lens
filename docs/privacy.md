# Privacy firewall

This page describes the design and is updated as features land.

## What stays on the phone

| Data | Where it lives |
|---|---|
| Audio | never stored; the platform's on-device speech recognizer (Android 12+) turns it into text. Without it the microphone stays off, because the regular recognizer may send audio to a server |
| Spoken and typed sentences | memory only, the last three, for resolving "it", "they", "here" |
| Location | only on request ("Set my area") and with the coarse permission only, so Android blurs the position. The coordinates are turned into the nearest city of 50,000 or more with a GeoNames table bundled in the app, then discarded; the platform geocoder is not used because it sends coordinates to a network service |
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

## Web companion and Chrome extension

This section is the privacy policy of the ContextLens web companion and Chrome extension.

- **No account, no analytics, no tracking.** Neither collects data for the developer: there is no ContextLens server, no analytics, no advertising and no data sale. Nothing is sent to the developer.
- **What you type** stays in the page's memory and is gone when the page or side panel closes. The extension reads nothing from the websites you visit: it has no access to pages, tabs, history or downloads, only to its own side panel.
- **What leaves your computer** goes only to Google's services for a Firebase project that you connect, through Google's Firebase SDK: in Strict mode only the clean question for a checkable claim, after the same personal-data check as in the app; in Balanced mode, when Chrome has no Gemini Nano, the sentence and its context (the sentences before it, the date, the area and the pinned topic you set), as the page says before you choose it. Without a connected project nothing leaves your computer.
- **The egress ledger** lists every request that carries your text, word for word. Sign-in and App Check, when your project's config asks for them, appear as one setup entry each; their later token requests carry none of your text and are not listed one by one.
- **Your project's settings** (the web app config or connect code) stay in the page's memory, or, if you tick **Remember on this device**, in the browser's local storage (the extension: its own storage). On the web companion, a remembered project with App Check also keeps App Check's token and reCAPTCHA's state in this browser. **Disconnect** deletes all of it. Removing the extension deletes everything it stored.
- **Google's services:** checks in your project run on Firebase AI Logic and Gemini under your project's terms. If your project's config asks for them: Firebase Authentication (an anonymous sign-in, kept in memory, renewed hourly) and, on the web companion only, App Check with reCAPTCHA Enterprise, which loads Google's reCAPTCHA script and sends it browser signals. Gemini Nano runs in Chrome on your computer.

Questions: [open an issue](https://github.com/nikolareljin/context-lens/issues) on the repository.


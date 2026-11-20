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
- **What leaves your computer** through the page goes only to Google's services for the Firebase project that is connected, through Google's Firebase SDK. In both modes: the clean question for a checkable claim, after a personal-data check. That check is pattern-based and can miss personal data: it looks for email addresses, phone numbers, card numbers, IBANs, US Social Security numbers, street addresses, and private names in recognized phrasings ("my friend …", "Call …", titles such as Dr or Aunt) from the recent sentences; on a match nothing is sent. In Balanced mode, while Gemini Nano isn't ready in this browser (not available, not downloaded yet, or still downloading), also the sentence itself with its context (the sentences before it, the date, the area and the pinned topic you set), before any personal-data check. Without a connected project the page itself sends nothing.
- **Links you click** open in your browser and go to that site under its own terms: **Search this in your browser** sends the clean question to Google Search, and source links and Search Suggestions open Google or the cited site. The web companion is served by GitHub Pages, which, like any web host, receives your IP address and browser details ([GitHub's privacy statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement)). **Download Gemini Nano** makes Chrome download the model from Google; none of your text is in that download.
- **Whose project:** requests go to whoever owns the connected Firebase project and run on its quota under the [Gemini API terms](https://ai.google.dev/gemini-api/terms); the owner can log them in that project. According to those terms, on a project without billing Google may use the content to improve its products and human reviewers may read it, so don't send sensitive or personal information (users in the EEA, Switzerland and the UK are covered by the paid-service terms either way); and checks grounded with Google Search, which every cloud check here is, are stored by Google for 30 days, with or without billing. Use a connect code only from someone you trust; your own project keeps the choice with you.
- **The egress ledger** lists the requests that carry your text, word for word (the newest 200, in memory only). Sign-in and App Check, when the project's config asks for them, appear as one setup entry each; their later token requests carry none of your text and are not listed one by one.
- **Your project's settings** (the web app config or connect code) stay in the page's memory, or, if you tick **Remember on this device**, in the browser's local storage. On the web companion that storage is shared by every site under `nikolareljin.github.io`, so remember a project only in a personal browser; the extension uses its own storage, separate from every website. On the web companion, a remembered project with App Check also keeps App Check's token and reCAPTCHA's state in this browser. **Disconnect** deletes what the page stored; cookies that Google's reCAPTCHA script sets are managed by Google and your browser. Removing the extension deletes everything it stored.
- **Google's services:** checks run on Firebase AI Logic and Gemini in the connected project. If the project's config asks for them: Firebase Authentication (an anonymous sign-in kept in memory; its token lasts an hour and is renewed when a cloud call needs a fresh one) and, on the web companion only, App Check with reCAPTCHA Enterprise, which loads Google's reCAPTCHA script and sends it browser signals. Gemini Nano runs in Chrome on your computer.

Questions: [open an issue](https://github.com/nikolareljin/context-lens/issues) on the repository.


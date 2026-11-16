# Changelog

All notable changes are listed here. Versions follow [SemVer](https://semver.org/); tags carry the bare version (`0.1.0`).

## [Unreleased]

### Fixed

- Listening in Strict mode asks the phone's model again when Android refuses a sentence for its usage quota (after 5 s, then 15 s), with the wait shown on the card; Balanced mode is not retried, since that call may already have gone to the cloud.
- The on-device evaluation retries a call Android refused for its usage quota (after 5 s, then 15 s) instead of scoring it as a miss, and its summary lists failure reasons and the ids of claims answered "no claim".

### Added

- Leak checks before anything is published: `./dev scan` and CI run gitleaks (tree and history), foxguard (reviewed false positives ignored inline with the reason), and a personal-data check over the tree and every commit and file version in a pull request (email addresses, phone numbers, Firebase identifiers, coordinates and image metadata).
- Gatekeeper evaluation: 73 made-up sentences in `eval/utterances.yaml`; `./dev eval` checks the local rules, date hints and personal-data check against every one; Diagnostics → Run evaluation scores Gemini Nano on the device (claim precision and recall, references, personal data left and sent, latency) with nothing sent.
- Listening screen layout: a context bar with the Strict/Balanced chip, the date, area and topic; three counters for the session (sentences read only on the phone, raw text sent, claims checked in the cloud) kept by the pipeline for the session; each card in three stages (heard, clean question, grounded check), whose labels say when the cloud read the sentence in Balanced mode, with the reported inference source as a colored pill, resolved references as tags and a colored verdict badge; "Run demo" plays a scripted conversation set in a fictional Springfield through the real pipeline, each card marked "Demo input".
- Hybrid pipeline: Tier 0 rules drop obvious small talk; Gemini Nano on the phone writes one self-contained question with the place, date and topic resolved (Strict: on device only; Balanced: may fall back to cloud Gemini, recorded as raw text sent); a personal-data check withholds any question that still carries a name, phone, email, card, IBAN, SSN or street address from the sentence or the ones before it; switching to Strict also covers sentences already waiting; cloud Gemini with Google Search grounding returns the verdict with Google's Search Suggestions chip, and no web source means "not enough evidence"; when the cloud refuses for quota or billing, the card offers a search of the clean question in the browser instead. Versioned prompts; every request that leaves the phone is in the egress ledger with its exact text, including one stopped midway by Clear, and the counters come from it.
- Listening session: on-device speech recognition with a restart loop (the microphone stays off where on-device recognition is missing), typed sentences, a pinned topic, the last three sentences in memory, relative dates resolved to ranges, and "Set my area" with a bundled GeoNames city table (no geocoder).
- Diagnostics: on-device model status, download with progress and warm-up; test calls on the device and in the cloud that show where the answer was computed and find the working cloud model; a call log and a copyable report without account IDs or speech.
- Scripted setup: `./dev cloud` signs in once and sets up the Firebase project, apps, APIs, Firestore, authentication, reCAPTCHA Enterprise, App Check and the repository variables; `./dev phone` pairs a phone by QR code over Wi-Fi, checks it and registers its App Check debug token.
- Web companion scaffold (React, TypeScript, Vite, Tailwind) at the site root with the Android download and QR code; the docs move to `/docs/`; `./dev web`; Search Console ownership file.
- Install from a QR code: a fixed `context-lens.apk` on every release, the code on the site and README, and `scripts/phone-install.sh` for USB installs.
- Logo, adaptive launcher icon with a themed variant, hero image and social card; app and site palette from the logo.
- Android app foundation: Compose Material 3, Firebase AI Logic with the on-device artifact, App Check per build type, anonymous sign-in, Listen, Ledger and Diagnostics destinations.
- Repository tooling: `./dev` command, build/test/docs/release/deploy scripts, CI, documentation site on GitHub Pages, release pull requests with automatic tags, signed release workflow.

### Fixed

- The personal-data check now recognizes a name after a family title with a possessive ("Aunt Rosa's house") and the name in an email address ("sam.rivera@…").
- The ledger counted refused cloud requests as not sent; it now reads "Clean questions answered" with the bytes that were sent.
- Docs pages lead back to the web app: the header logo and a first "App" entry in the navigation; the app header links Setup as well as Docs and Privacy.

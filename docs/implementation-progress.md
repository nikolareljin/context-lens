# Implementation progress

A dated record of the work done during the hackathon. Each entry lists what was built, how it was verified, and what is still open.

## 2026-11-14

- Repository created: license, contributing and security notes, `./dev` command with build, test, lint, docs, release and deploy scripts; CI (Android, docs, scripts, secret scan), documentation site, release pull requests with automatic tags, signed release and App Distribution workflows (inactive until the Firebase project and signing secrets exist).
- Verified: script tests, shellcheck and the strict documentation build locally and in CI.
- Open: Android app foundation, diagnostics, session context, the two-tier pipeline, the main screen, evaluation.

## 2026-11-14: Android foundation

- `apps/android`: Kotlin, Jetpack Compose Material 3, minSdk 26, targetSdk 35, compileSdk 36; Android Gradle plugin 8.13.2, Gradle 8.14 (wrapper checksum pinned), Kotlin 2.4.21.
- Firebase BoM 35.2.0 with Firebase AI Logic (`firebase-ai` 18.2.0) and the on-device artifact (`firebase-ai-ondevice` 16.0.0-beta08), App Check (debug provider in debug builds, Play Integrity in release builds; each lives only in its own source set), Anonymous Auth, Remote Config, Crashlytics (release builds only).
- Three destinations: Listen, Ledger, Diagnostics. Diagnostics shows the app version, device, App Check provider and sign-in state.
- Verified: lint, unit tests, debug and release (R8) builds; on an Android 11 emulator the app launches, installs the debug provider and reports the failed sign-in of the placeholder configuration as such.
- Note: the newest AndroidX releases (Compose BOM 2026.09, core 1.19) need Android Gradle plugin 9.1 and compileSdk 37; the app uses Compose BOM 2026.01.01, core 1.17.0, lifecycle 2.10.0, navigation 2.9.8 and activity 1.12.4 until the build moves to plugin 9.
- Open: on-device model status and download, the inference log.

## 2026-11-14: logo, hero and palette

- New logo (lens with a local waveform, a privacy line and a verified check) as the site logo and favicon, an adaptive launcher icon with a themed monochrome variant, a hero image of the three stages, and a social preview card.
- App theme (light and dark, including container colors), site palette and header follow the logo.
- Verified: lint and debug build; the icon and both themes checked on an Android 11 emulator; strict docs build.

## 2026-11-14: install from a QR code

- Every release also carries `context-lens.apk`, so `releases/latest/download/context-lens.apk` always serves the newest APK; a QR code for that address on the home page, the download page and the README.
- `scripts/phone-install.sh` (also `./dev phone-install`): installs a release APK over USB with nothing but curl and unzip on the computer, downloading platform-tools when adb is missing.
- Verified: the QR code decodes to the fixed address; script tests with stand-ins for adb and curl; strict docs build.

## 2026-11-14: web companion scaffold

- `apps/web`: React 19, TypeScript, Vite, Tailwind, served at `https://nikolareljin.github.io/context-lens/`; the docs moved to `/context-lens/docs/`. One Pages workflow builds both into one artifact.
- The page explains the three stages, offers the signed APK (button and QR code) and says when the build has no Firebase configuration; the live demo is the next step.
- Firebase web configuration comes from build-time values, never from the repository; `docs/web-setup.md` lists them with the console and Chrome steps. (Since Nov 17 the published site is built without any.)
- `./dev web` (install, lint, test, build, dev, check) uses the local npm on Node 20+ or a `node:22` container.
- The Search Console ownership file is served from the site root.
- Verified: type check, 6 unit tests and the production build in `node:22`; the assembled site (app plus docs) built locally.


## 2026-11-15: listening screen

- Context bar with the Strict/Balanced chip, date, area and pinned topic; three counters for the session (sentences read only on the phone, raw text sent, claims checked in the cloud), with raw text sent in green at 0 B and red above it. In Balanced mode, when the cloud reads a sentence, the card says so instead of "stays on this phone".
- Cards in three stages: what was heard (marked "stays on this phone" only when the local rules or the on-device model read it), the clean question with resolved references and the reported inference source, and the grounded check with a verdict badge, sources and Google's Search Suggestions. Where a sentence stopped is shown under the last stage it reached.
- Demo script: a fixed conversation in a fictional Springfield goes through the real pipeline; cards are marked "Demo input".
- Verified: unit tests (demo script, runner start, stop and restart), lint; on the S26 the demo filtered four small-talk lines with no model call, wrote both questions on the device (`ON_DEVICE`, Gemini Nano, about 2 s), dropped the name and number from the phone-number line, and sent 0 B of raw text. The cloud check is refused until billing is on, and the card offers the search link instead.

## 2026-11-15: hybrid pipeline and evaluation

- Tier 0 rules, the on-device gatekeeper (Strict: phone only; Balanced: may fall back to the cloud), the personal-data check on every clean question, the grounded cloud check with Google's Search Suggestions, and the egress ledger with the exact text of every request that left the phone.
- When the cloud refuses for quota or billing, the card offers a browser search of the clean question instead.
- Evaluation: 77 made-up sentences in `eval/utterances.yaml`; `./dev eval` checks the local rules against all of them, and Diagnostics → Run evaluation scores Gemini Nano on the phone with nothing sent.
- Verified: unit tests, lint; on the S26 the questions were written on the device with 0 B of raw text sent.

## 2026-11-16: leak checks, quota retries, prompt v2

- CI and `./dev scan` run gitleaks, foxguard and a personal-data check before anything is published.
- Calls Android refuses for its usage quota are retried after 5 s and 15 s, in the evaluation and when listening in Strict mode.
- Gatekeeper prompt v2: the model names the kind of sentence, and myths, false statements and general facts count as claims.
- Verified on the S26 (58 scored sentences, Strict): claim recall 75% → 94%, precision 96% → 94%, no personal data left in any question, median about 1.35 s. Details in [Evaluation](evaluation.md).

## 2026-11-16: offline

- With no network, the cloud step is skipped: the card says the phone is offline, offers a browser search, and nothing is tried or recorded as sent.
- Verified in airplane mode on the S26: the on-device evaluation ran 58 of 58 sentences with none failed, the demo cards showed the offline message, and the ledger read "No request has left this phone."

## 2026-11-17: release 0.1.0

- The first signed release with the APK at the fixed download address; the download page and home page point to it.

# Changelog

All notable changes are listed here. Versions follow [SemVer](https://semver.org/); tags carry the bare version (`0.1.0`).

## [Unreleased]

### Added

- Listening session: on-device speech recognition with a restart loop (the microphone stays off where on-device recognition is missing), typed sentences, a pinned topic, the last three sentences in memory, relative dates resolved to ranges, and "Set my area" with a bundled GeoNames city table (no geocoder).
- Diagnostics: on-device model status, download with progress and warm-up; test calls on the device and in the cloud that show where the answer was computed and find the working cloud model; a call log and a copyable report without account IDs or speech.
- Scripted setup: `./dev cloud` signs in once and sets up the Firebase project, apps, APIs, Firestore, authentication, reCAPTCHA Enterprise, App Check and the repository variables; `./dev phone` pairs a phone by QR code over Wi-Fi, checks it and registers its App Check debug token.
- Web companion scaffold (React, TypeScript, Vite, Tailwind) at the site root with the Android download and QR code; the docs move to `/docs/`; `./dev web`; Search Console ownership file.
- Install from a QR code: a fixed `context-lens.apk` on every release, the code on the site and README, and `scripts/phone-install.sh` for USB installs.
- Logo, adaptive launcher icon with a themed variant, hero image and social card; app and site palette from the logo.
- Android app foundation: Compose Material 3, Firebase AI Logic with the on-device artifact, App Check per build type, anonymous sign-in, Listen, Ledger and Diagnostics destinations.
- Repository tooling: `./dev` command, build/test/docs/release/deploy scripts, CI, documentation site on GitHub Pages, release pull requests with automatic tags, signed release workflow.

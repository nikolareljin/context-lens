# Changelog

All notable changes are listed here. Versions follow [SemVer](https://semver.org/); tags carry the bare version (`0.1.0`).

## [Unreleased]

### Added

- Web companion scaffold (React, TypeScript, Vite, Tailwind) at the site root with the Android download and QR code; the docs move to `/docs/`; `./dev web`; Search Console ownership file.
- Install from a QR code: a fixed `context-lens.apk` on every release, the code on the site and README, and `scripts/phone-install.sh` for USB installs.
- Logo, adaptive launcher icon with a themed variant, hero image and social card; app and site palette from the logo.
- Android app foundation: Compose Material 3, Firebase AI Logic with the on-device artifact, App Check per build type, anonymous sign-in, Listen, Ledger and Diagnostics destinations.
- Repository tooling: `./dev` command, build/test/docs/release/deploy scripts, CI, documentation site on GitHub Pages, release pull requests with automatic tags, signed release workflow.

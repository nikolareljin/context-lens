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


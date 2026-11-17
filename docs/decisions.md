# Decisions

Short records of product and architecture choices. Newest last.

## 2026-11-14: Apache-2.0

Matches the Android and Firebase ecosystem and the hackathon's recommendation.

## 2026-11-14: one command for local work and CI

`./dev` wraps every build, test, release and deploy step; the workflows call the same scripts, so a green local run predicts a green CI run.

## 2026-11-17: public builds carry no Firebase project

CI debug APKs, release APKs and the published site are built with the placeholder configuration, so nobody who downloads them uses the maintainer's Firebase project or its quota. The grounded cloud check runs on a project the user connects; the maintainer's own builds use a `google-services.json` that stays on the build machine. The 0.1.0 APK and earlier CI builds did carry the project configuration; those files were removed and the project's API keys replaced, so the old keys no longer work.

## 2026-11-14: secrets only from the environment

`google-services.json`, signing keys and deploy credentials are git-ignored. CI writes them from repository secrets at job start; pull requests without access to secrets build against a placeholder Firebase configuration that cannot reach any project.

## 2026-11-14: Strict mode is the default

With `PREFER_ON_DEVICE`, a phone that cannot run Gemini Nano would send the raw sentence and its context to the cloud. The default is therefore `ONLY_ON_DEVICE`; the device-preferred mode is an explicit opt-in with that consequence stated.

## 2026-11-14: offline region lookup

The platform geocoder sends coordinates to a network service on most phones. The coarse region comes from a city table bundled with the app instead, and the coordinates are discarded after the lookup.

## 2026-11-14: rules after the model

The model proposes; deterministic code decides what is sent (personal-data rules) and how a verdict is shown (no source means insufficient evidence).

## 2026-11-14: the logo sets the palette

Deep slate surfaces, cyan for work on the device, indigo to violet for the cloud, emerald for a verified claim. The app theme, the launcher icon, the site and the hero image use the same tokens; status colors always come with an icon and a label.

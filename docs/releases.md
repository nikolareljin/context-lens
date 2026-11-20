# Releases

## Versions

Versions follow [Semantic Versioning](https://semver.org/). Tags carry the bare version (`0.3.0`). One version covers the whole repository: the Android `versionName` comes from the `VERSION` file, the web companion's package version is set to match it in each release commit, and the Chrome extension's manifest version is read from `VERSION` at build time.

| Version | Content |
|---|---|
| 0.1.x | the complete loop: on-device gatekeeper, grounded cloud check, privacy firewall, diagnostics, evaluation |
| 0.2.x | web companion in Chrome (live demo on your own project) |
| 0.3.x | Chrome extension (side panel) |
| 0.4.x | Chrome Web Store package, install options, link previews |
| 0.5.x | home page: access code, step-by-step demo, recorded and live modes |
| 0.6.x | Remote Config tuning, offline outbox; slide context from one photo, on device |
| 0.9.x | release candidates |
| 1.0.0 | hackathon submission |

## Channels

| Channel | When | What |
|---|---|---|
| CI artifact | every pull request and push to `main` | debug APK |
| Firebase App Distribution | every merge to `main` that touches the app, once enabled | signed build for testers |
| GitHub Releases | every version tag | signed APK and AAB, the Chrome extension zip and its SHA-256, the Chrome Web Store zip, release notes |
| This site | every merge to `main` that touches the docs | rebuilt and published; the download page always points at the latest release |

## How a release is made

1. `./dev version --dry-run` shows the next version, derived from the Conventional Commits since the last tag: a breaking change bumps the major version (the minor one while the version is `0.x`), `feat` bumps the minor version, anything else the patch version. A level or an exact version can be given instead.
2. `./dev version --pr` writes `VERSION` and the web companion's package version (`apps/web/package.json` and its lock file), dates the `## [Unreleased]` changelog entries as the new version, commits on `release/X.Y.Z` and opens the pull request.
3. Merging that pull request tags the merge commit (`tag-release` workflow), builds the signed APK and AAB, the Chrome extension zip with its SHA-256 and the Chrome Web Store zip, and publishes the GitHub release.

Published tags are immutable: the workflow may create a tag, never move or delete one. `./dev release` remains as a manual fallback that tags `main` directly.

Each release lists its changelog section, the pull requests it contains and a compare link.

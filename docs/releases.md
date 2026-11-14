# Releases

## Versions

Versions follow [Semantic Versioning](https://semver.org/). Tags carry the bare version (`0.3.0`), and the Android `versionName` comes from the `VERSION` file.

| Version | Content |
|---|---|
| 0.1.x | the complete loop: on-device gatekeeper, grounded cloud check, privacy firewall, diagnostics, evaluation |
| 0.2.x | Remote Config tuning |
| 0.3.x | offline outbox |
| 0.4.x | slide context from one photo, on device |
| 0.5.x | server prompt templates |
| 0.9.x | release candidates |
| 1.0.0 | hackathon submission |

## Channels

| Channel | When | What |
|---|---|---|
| CI artifact | every pull request and push to `main` | debug APK |
| Firebase App Distribution | every merge to `main` that touches the app, once enabled | signed build for testers |
| GitHub Releases | every version tag | signed APK and AAB, release notes |
| This site | every merge to `main` that touches the docs | rebuilt and published; the download page always points at the latest release |

## How a release is made

1. `./dev version --dry-run` shows the next version, derived from the Conventional Commits since the last tag: a breaking change bumps the major version (the minor one while the version is `0.x`), `feat` bumps the minor version, anything else the patch version. A level or an exact version can be given instead.
2. `./dev version --pr` writes `VERSION`, dates the `## [Unreleased]` changelog entries as the new version, commits on `release/X.Y.Z` and opens the pull request.
3. Merging that pull request tags the merge commit (`tag-release` workflow), builds the signed APK and AAB and publishes the GitHub release.

Published tags are immutable: the workflow may create a tag, never move or delete one. `./dev release` remains as a manual fallback that tags `main` directly.

Each release lists its changelog section, the pull requests it contains and a compare link.

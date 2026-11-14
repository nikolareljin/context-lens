#!/usr/bin/env bash
# Tag a release from main. The tag push starts the release workflow.
#
# Usage: scripts/release.sh [--dry-run]
# Checks: on main, clean tree, up to date with origin/main, VERSION is
# MAJOR.MINOR.PATCH, CHANGELOG.md has a "## [VERSION]" section, the tag does
# not exist yet. Then: annotated tag VERSION on HEAD, pushed to origin.
# Stand-in for tests: GIT_REMOTE (default origin).
set -euo pipefail
TL_TAG=release
# shellcheck source=lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
cd "$TL_ROOT"

dry=0
[[ "${1:-}" == "--dry-run" ]] && dry=1
remote="${GIT_REMOTE:-origin}"
v="$(version)"

is_semver "$v" || die "VERSION must be MAJOR.MINOR.PATCH without a prefix (found '$v')"
[[ "$(git rev-parse --abbrev-ref HEAD)" == main ]] || die "release from main only"
[[ -z "$(git status --porcelain)" ]] || die "working tree is not clean"
git fetch -q "$remote" main
[[ "$(git rev-parse HEAD)" == "$(git rev-parse "$remote/main")" ]] || die "main is not equal to $remote/main"
grep -Eq "^## \[${v//./\\.}\]( |$)" CHANGELOG.md || die "CHANGELOG.md has no '## [$v]' section"
if git rev-parse -q --verify "refs/tags/$v" >/dev/null || git ls-remote --exit-code --tags "$remote" "refs/tags/$v" >/dev/null 2>&1; then
  die "tag $v exists already"
fi

if [[ "$dry" -eq 1 ]]; then
  log "dry run: would tag $v on $(git rev-parse --short HEAD) and push it"; exit 0
fi
git tag -a "$v" -m "$v"
git push "$remote" "refs/tags/$v"
log "tagged and pushed $v"

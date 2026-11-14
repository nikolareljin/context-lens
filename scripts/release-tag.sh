#!/usr/bin/env bash
# Tag a merged release pull request (run by the tag-release workflow).
#
# Usage: scripts/release-tag.sh <head-branch> <merge-sha>
# Checks: head branch is release/X.Y.Z, VERSION at the merge commit is X.Y.Z,
# CHANGELOG.md there has "## [X.Y.Z]", the tag exists neither locally nor on
# the remote. Then: annotated tag on the merge commit, pushed. Writes tag=X.Y.Z
# to $GITHUB_OUTPUT when set. Stand-in for tests: GIT_REMOTE.
set -euo pipefail
TL_TAG=release-tag
# shellcheck source=lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
cd "$TL_ROOT"

branch="${1:?head branch}"; sha="${2:?merge sha}"
remote="${GIT_REMOTE:-origin}"
[[ "$branch" =~ ^release/(.+)$ ]] || die "not a release branch: $branch"
v="${BASH_REMATCH[1]}"
is_semver "$v" || die "release branch must be release/MAJOR.MINOR.PATCH (found $branch)"
file_v="$(git show "$sha:VERSION" | tr -d '[:space:]')"
[[ "$file_v" == "$v" ]] || die "VERSION at $sha is '$file_v', branch says $v"
grep -Eq "^## \[${v//./\\.}\]( |$)" < <(git show "$sha:CHANGELOG.md") || die "CHANGELOG.md at $sha has no '## [$v]' section"
if git rev-parse -q --verify "refs/tags/$v" >/dev/null || git ls-remote --exit-code --tags "$remote" "refs/tags/$v" >/dev/null 2>&1; then
  die "tag $v exists already"
fi

git -c user.name="${TAGGER_NAME:-github-actions[bot]}" \
    -c user.email="${TAGGER_EMAIL:-41898282+github-actions[bot]@users.noreply.github.com}" \
    tag -a "$v" "$sha" -m "$v"
git push -q "$remote" "refs/tags/$v"
log "tagged $v on $sha"
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then echo "tag=$v" >> "$GITHUB_OUTPUT"; fi

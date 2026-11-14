#!/usr/bin/env bash
# Print release notes for a version: its CHANGELOG section, then the pull
# requests merged since the previous tag, then a compare link.
#
# Usage: scripts/release-notes.sh <version> [repo-url]
set -euo pipefail
TL_TAG=release-notes
# shellcheck source=lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
cd "$TL_ROOT"

v="${1:?version}"
url="${2:-}"
is_semver "$v" || die "not a version: $v"

awk -v want="## [$v]" '
  index($0, want) == 1 { on = 1; next }
  on && /^## \[/ { exit }
  on { print }
' CHANGELOG.md

# the previous release: the highest version tag below this one
prev=""
while IFS= read -r t; do
  is_semver "$t" || continue
  [[ "$t" == "$v" ]] && continue
  [[ "$(printf '%s\n%s\n' "$t" "$v" | sort -V | head -1)" == "$t" ]] && prev="$t"
done < <(git tag --list '[0-9]*.[0-9]*.[0-9]*' --sort=v:refname)

# pull_requests <range>: one "- title (#N)" line per pull request on the
# first-parent line; merge commits carry the title in their body, squash and
# rebase merges end their subject with "(#N)".
pull_requests() {
  git log --first-parent --format='%s%x1f%b%x1e' "$1" | awk 'BEGIN { RS = "\x1e"; FS = "\x1f" }
    {
      sub(/^\n+/, "", $1)
      if (match($1, /^Merge pull request #[0-9]+ from /)) {
        n = $1; sub(/^Merge pull request /, "", n); sub(/ from .*/, "", n)
        title = $2; sub(/^\n+/, "", title); sub(/\n.*/, "", title)
        print "- " (title != "" ? title " " : "") "(" n ")"
      } else if ($1 ~ /\(#[0-9]+\)$/) {
        print "- " $1
      }
    }'
}

if git rev-parse -q --verify "refs/tags/$v" >/dev/null; then
  prs="$(pull_requests "${prev:+$prev..}$v")"
  if [[ -n "$prs" ]]; then
    echo
    echo "### Pull requests"
    echo
    echo "$prs"
  fi
fi
if [[ -n "$url" && -n "$prev" ]]; then
  echo
  echo "**Changes:** $url/compare/$prev...$v"
fi

#!/usr/bin/env bash
# Prepare a release: bump VERSION (and the web companion's package version to
# match), date the changelog section, commit on a
# release/X.Y.Z branch, and (with --pr) push it and open the pull request.
# Merging that pull request tags the merge commit and publishes the release.
#
# Usage: scripts/version.sh [auto|patch|minor|major|X.Y.Z] [--pr] [--dry-run]
#   auto (default)  from Conventional Commits since the last tag:
#                   breaking change -> major (minor while 0.x), feat -> minor, else patch
#   --pr            push the branch and open the pull request (gh)
#   --dry-run       print the next version and stop
#
# Needs: clean tree on main, equal to origin/main, and entries under
# "## [Unreleased]" in CHANGELOG.md. Stand-ins for tests: GH, GIT_REMOTE.
set -euo pipefail
TL_TAG=version
# shellcheck source=lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
cd "$TL_ROOT"

level="auto"; pr=0; dry=0
for a in "$@"; do
  case "$a" in
    --pr) pr=1 ;;
    --dry-run) dry=1 ;;
    -h|--help) usage_from "${BASH_SOURCE[0]}"; exit 0 ;;
    *) level="$a" ;;
  esac
done
remote="${GIT_REMOTE:-origin}"
gh_cmd="${GH:-gh}"

last_tag() { git tag --list '[0-9]*.[0-9]*.[0-9]*' --sort=-v:refname | head -1; }

# bump <version> <major|minor|patch>
bump() {
  local ma mi pa
  IFS=. read -r ma mi pa <<<"$1"
  case "$2" in
    major) echo "$((ma + 1)).0.0" ;;
    minor) echo "$ma.$((mi + 1)).0" ;;
    patch) echo "$ma.$mi.$((pa + 1))" ;;
  esac
}

# auto_level <rev-range>: the bump the commits in the range call for.
auto_level() {
  local log
  log="$(git log --format='%s%n%b%n--' "$1")"
  if grep -Eq '^[a-z]+(\([^)]*\))?!:|^BREAKING[ -]CHANGE:' <<<"$log"; then echo major
  elif grep -Eq '^feat(\([^)]*\))?:' <<<"$log"; then echo minor
  else echo patch; fi
}

# tags made by the release workflow exist on the remote first
if ! git fetch -q --tags "$remote" 2>/dev/null; then
  [[ "$dry" -eq 1 ]] || die "could not fetch tags from $remote"
  warn "could not fetch tags from $remote; using local tags only"
fi
prev="$(last_tag)"
base="${prev:-$(version)}"
is_semver "$base" || die "cannot read the current version (found '$base')"

case "$level" in
  auto)
    if [[ -n "$prev" ]]; then lvl="$(auto_level "$prev..HEAD")"; else lvl="$(auto_level HEAD)"; fi
    if [[ "$lvl" == major && "${base%%.*}" == 0 ]]; then lvl=minor; fi
    next="$(bump "$base" "$lvl")" ;;
  major|minor|patch) next="$(bump "$base" "$level")" ;;
  *) is_semver "$level" || die "not a version or level: $level"; next="$level" ;;
esac

if [[ -n "$prev" ]]; then
  highest="$(printf '%s\n%s\n' "$prev" "$next" | sort -V | tail -1)"
  if [[ "$prev" == "$next" || "$highest" != "$next" ]]; then
    die "$next is not above the last tag $prev"
  fi
fi

if [[ "$dry" -eq 1 ]]; then echo "$next"; exit 0; fi

[[ "$(git rev-parse --abbrev-ref HEAD)" == main ]] || die "run from main"
[[ -z "$(git status --porcelain)" ]] || die "working tree is not clean"
git fetch -q "$remote" main
[[ "$(git rev-parse HEAD)" == "$(git rev-parse "$remote/main")" ]] || die "main is not equal to $remote/main"
if git rev-parse -q --verify "refs/heads/release/$next" >/dev/null \
   || git ls-remote --exit-code --heads "$remote" "release/$next" >/dev/null 2>&1; then
  die "branch release/$next exists already (locally or on $remote)"
fi

unreleased="$(awk '/^## \[Unreleased\]/ { on = 1; next } on && /^## \[/ { exit } on { print }' CHANGELOG.md)"
grep -q '[^[:space:]]' <<<"$unreleased" || die "nothing under ## [Unreleased] in CHANGELOG.md"

web=apps/web
if [[ -f "$web/package.json" ]]; then
  command -v jq >/dev/null || die "jq is needed to set the web package version"
  for f in "$web/package.json" "$web/package-lock.json"; do
    [[ ! -f "$f" ]] || jq -e 'type == "object"' "$f" >/dev/null 2>&1 || die "$f is not a JSON object"
  done
fi

git switch -q -c "release/$next"
echo "$next" > VERSION
# One version for the whole repository: the web companion's package follows VERSION.
if [[ -f "$web/package.json" ]]; then
  jq --arg v "$next" '.version = $v' "$web/package.json" > "$web/package.json.tmp"
  mv "$web/package.json.tmp" "$web/package.json"
  git add "$web/package.json"
  if [[ -f "$web/package-lock.json" ]]; then
    jq --arg v "$next" '.version = $v | if .packages[""] then .packages[""].version = $v else . end' \
      "$web/package-lock.json" > "$web/package-lock.json.tmp"
    mv "$web/package-lock.json.tmp" "$web/package-lock.json"
    git add "$web/package-lock.json"
  fi
fi
today="$(date -u +%F)"
awk -v v="$next" -v d="$today" '
  /^## \[Unreleased\]/ && !done { print; print ""; print "## [" v "] - " d; done = 1; next }
  { print }
' CHANGELOG.md > CHANGELOG.md.tmp
mv CHANGELOG.md.tmp CHANGELOG.md
git add VERSION CHANGELOG.md
git commit -q -m "chore(release): $next"
log "release/$next prepared ($base -> $next)"

if [[ "$pr" -eq 1 ]]; then
  git push -q -u "$remote" "release/$next"
  notes="$(bash "$TL_ROOT/scripts/release-notes.sh" "$next")"
  body="Merging this pull request tags \`$next\` on the merge commit and publishes the release.

$notes"
  "$gh_cmd" pr create --base main --head "release/$next" --title "chore(release): $next" --body "$body"
  git switch -q main
  log "back on main; the release happens when the pull request merges"
else
  log "next: push release/$next and open its pull request, or rerun with --pr"
fi

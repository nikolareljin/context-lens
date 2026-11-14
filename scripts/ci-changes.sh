#!/usr/bin/env bash
# Print which CI areas a change touches, as GitHub output lines.
#
# Usage: scripts/ci-changes.sh <base> <head>
# Output: android=true|false, functions=..., web=..., firebase=..., docs=...
# An area is reported only when its directory exists at <head>. Changes to CI
# itself (.github/, scripts/) mark every present area.
set -euo pipefail
base="${1:?base}"; head="${2:?head}"
files="$(git diff --name-only "$base" "$head")"

present() { git cat-file -e "$head:$1" 2>/dev/null; }
touched() { grep -Eq "$1" <<<"$files"; }

all=false
touched '^(\.github/|scripts/)' && all=true

report() {
  local name="$1" dir="$2" pattern="$3" v=false
  if present "$dir" && { [[ "$all" == true ]] || touched "$pattern"; }; then v=true; fi
  echo "$name=$v"
}
report android apps/android '^(apps/android/|VERSION$)'
report functions functions '^functions/'
report web apps/web '^apps/web/'
report firebase firebase '^(firebase/|firebase\.json$)'
report docs mkdocs.yml '^(docs/|mkdocs\.yml$)'

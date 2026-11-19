#!/usr/bin/env bash
# Fails when a built site carries a Firebase key, app id or project host. The published
# site has no Firebase project: visitors connect their own in the browser. Run it on the
# assembled output (apps/web/dist, or the Pages artifact with the docs).
#
# Usage: scripts/site-leak-check.sh <dir>
#
# Fails on, in any file under <dir> (text or binary):
#   - a web API key (AIza followed by 35 key characters)
#   - a Firebase app id (<number>:<project number>:web|android|ios:<hex>)
#   - a *.firebaseapp.com or *.web.app host, unless its name starts with "demo-" (the
#     Firebase convention for projects that do not exist, used only as documentation examples)
# Matches are reported by file, line and kind; the matched value is never printed.
set -euo pipefail
TL_TAG=site-leak
# shellcheck source=lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

case "${1:-}" in
  -h|--help) usage_from "${BASH_SOURCE[0]}"; exit 0 ;;
  "") die "usage: scripts/site-leak-check.sh <dir>" 2 ;;
esac
dir="$1"
[[ -d "$dir" ]] || die "not a directory: $dir" 2

key_re='AIza[0-9A-Za-z_-]{35}'
app_re='[0-9]+:[0-9]{6,}:(web|android|ios):[0-9a-f]+'
host_re='[A-Za-z0-9.-]*[A-Za-z0-9-]\.(firebaseapp\.com|web\.app)'
# only a host whose own name starts with "demo-"
host_ok='^([A-Za-z0-9-]+\.)*demo-[A-Za-z0-9-]*\.(firebaseapp\.com|web\.app)$'

hits=0
# report <kind> <pattern> [allowed]: one line per match, without the value.
report() {
  local kind="$1" pattern="$2" allowed="${3:-}" line
  while IFS= read -r line; do
    echo "  ${line%%:*}: $kind" >&2
    hits=$((hits + 1))
  done < <(
    # file:line:match -> file:line, keeping only matches outside the allowlist
    grep -rnoaE -- "$pattern" "$dir" 2>/dev/null \
      | OK="$allowed" awk '{
          ok = ENVIRON["OK"]
          i = index($0, ":"); j = index(substr($0, i + 1), ":")
          where = substr($0, 1, i + j - 1); value = substr($0, i + j + 1)
          if (ok == "" || value !~ ok) print where
        }' \
      | sed 's/:\([0-9]*\)$/ line \1/' || true
  )
}

report "Firebase web API key" "$key_re"
report "Firebase app id" "$app_re"
report "Firebase project host" "$host_re" "$host_ok"

if [[ "$hits" -gt 0 ]]; then
  die "$hits Firebase value(s) in $dir: the site must not carry any project"
fi
log "no Firebase key, app id or project host in $dir"

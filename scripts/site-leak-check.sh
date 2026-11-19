#!/usr/bin/env bash
# Fails when a built site carries a Firebase key, app id, project host or reCAPTCHA site key.
# The published site has no Firebase project: visitors connect their own in the browser.
# Run it on the assembled output (apps/web/dist, or the Pages artifact with the docs).
#
# Usage: scripts/site-leak-check.sh <dir>
#
# Fails on, in any file under <dir> (text or binary; symbolic links are followed, as the
# Pages upload follows them):
#   - a web API key (AIza followed by 35 key characters)
#   - a Firebase app id (<number>:<project number>:web|android|ios:<hex>)
#   - a *.firebaseapp.com, *.web.app, *.firebasestorage.app or *.appspot.com host, unless
#     its name starts with "demo-" (the Firebase convention for projects that do not exist,
#     used only as documentation examples)
#   - a reCAPTCHA site key (6L followed by 38 key characters)
#   - the project id of a maintainer configuration, when LEAK_CHECK_CONFIG names one (a local
#     google-services.json or web config); without it, that check is skipped
#   - a file or directory that cannot be read
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
host_re='[A-Za-z0-9.-]*[A-Za-z0-9-]\.(firebaseapp\.com|web\.app|firebasestorage\.app|appspot\.com)'
# only a host whose own name starts with "demo-"
host_ok='^([A-Za-z0-9-]+\.)*demo-[A-Za-z0-9-]*\.(firebaseapp\.com|web\.app|firebasestorage\.app|appspot\.com)$'
site_key_re='(^|[^0-9A-Za-z_-])6L[0-9A-Za-z_-]{38}([^0-9A-Za-z_-]|$)'

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
hits=0

# matches <pattern> <out> [grep options]: file:line:match lines; fails on unreadable input.
matches() {
  local pattern="$1" out="$2" status=0; shift 2
  grep -Rnoa "$@" -- "$pattern" "$dir" > "$out" 2> "$tmp/err" || status=$?
  if [[ "$status" -gt 1 ]]; then
    sed 's/^/  /' "$tmp/err" >&2
    die "could not read everything under $dir" 2
  fi
}

# report <kind> <pattern> [allowed] [grep options]: one line per match, without the value.
report() {
  local kind="$1" pattern="$2" allowed="$3" line; shift 3
  matches "$pattern" "$tmp/m" -E "$@"
  while IFS= read -r line; do
    echo "  $line: $kind" >&2
    hits=$((hits + 1))
  done < <(
    # file:line:match -> file line N, keeping only matches outside the allowlist
    OK="$allowed" awk '{
        ok = ENVIRON["OK"]
        i = index($0, ":"); j = index(substr($0, i + 1), ":")
        where = substr($0, 1, i + j - 1); value = substr($0, i + j + 1)
        if (ok == "" || value !~ ok) print where
      }' "$tmp/m" | sed 's/:\([0-9]*\)$/ line \1/'
  )
}

report "Firebase web API key" "$key_re" ""
report "Firebase app id" "$app_re" ""
report "Firebase project host" "$host_re" "$host_ok"
report "reCAPTCHA site key" "$site_key_re" ""

# The maintainer's own project id, from a local configuration that never enters the repository.
if [[ -n "${LEAK_CHECK_CONFIG:-}" ]]; then
  [[ -f "$LEAK_CHECK_CONFIG" ]] || die "LEAK_CHECK_CONFIG is not a file" 2
  project="$(sed -nE 's/.*"?(project_id|projectId)"?[[:space:]]*:[[:space:]]*"([a-z][a-z0-9-]{4,28}[a-z0-9])".*/\2/p' \
    "$LEAK_CHECK_CONFIG" | awk "NR == 1")"
  [[ -n "$project" ]] || die "no project id in LEAK_CHECK_CONFIG" 2
  matches "$project" "$tmp/p" -F
  while IFS= read -r line; do
    echo "  $line: the maintainer's project id" >&2
    hits=$((hits + 1))
  done < <(awk '{ i = index($0, ":"); j = index(substr($0, i + 1), ":"); print substr($0, 1, i + j - 1) }' "$tmp/p" \
    | sed 's/:\([0-9]*\)$/ line \1/')
fi

if [[ "$hits" -gt 0 ]]; then
  die "$hits Firebase value(s) in $dir: the site must not carry any project"
fi
log "no Firebase key, app id, project host or site key in $dir"

#!/usr/bin/env bash
# Make a QR code that connects ContextLens to a Firebase project, for testers who
# should not set one up themselves. The values go in the link's fragment (after #),
# which the site's connect page reads on the phone and never sends anywhere.
#
# Usage: scripts/connect-qr.sh <google-services.json> [out.png]
#   default output: ~/.config/context-lens/connect-qr.png (mode 600)
# Refuses to write inside the repository and never prints the key.
set -euo pipefail
TL_TAG=connect-qr
# shellcheck source=lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
need python3 "to read the configuration"

src="${1:-}"
[[ -n "$src" && -f "$src" ]] || die "usage: scripts/connect-qr.sh <google-services.json> [out.png]"
out="${2:-$HOME/.config/context-lens/connect-qr.png}"
mkdir -p "$(dirname "$out")"
abs="$(cd "$(dirname "$out")" && pwd)/$(basename "$out")"
[[ "$abs" != "$TL_ROOT"/* ]] || die "the QR code carries a key: write it outside the repository"

base="${CONNECT_PAGE:-https://nikolareljin.github.io/context-lens/connect/}"
link="$(python3 - "$src" "$base" <<'PY'
import json, re, sys, urllib.parse
data = json.load(open(sys.argv[1]))
project = data["project_info"]["project_id"]
client = next(c for c in data["client"]
              if c["client_info"]["android_client_info"]["package_name"] == "com.contextlens.app")
app = client["client_info"]["mobilesdk_app_id"]
key = client["api_key"][0]["current_key"]
ok = (re.fullmatch(r"[a-z][a-z0-9-]{4,28}[a-z0-9]", project) and project != "placeholder-project"
      and re.fullmatch(r"1:\d+:android:[0-9a-f]+", app) and re.fullmatch(r"AIza[0-9A-Za-z_-]{35}", key))
if not ok:
    sys.exit("the file has no usable com.contextlens.app client")
print(sys.argv[2] + "#" + urllib.parse.urlencode({"project": project, "app": app, "key": key}))
PY
)"

umask 077
if command -v segno >/dev/null 2>&1; then
  segno --scale 8 --output "$abs" "$link"
else
  need pipx "to run segno, the QR generator (or: pipx install segno)"
  pipx run --quiet segno --scale 8 --output "$abs" "$link"
fi
chmod 600 "$abs"
log "wrote $abs (keep it private; it connects to $(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["project_info"]["project_id"])' "$src"))"

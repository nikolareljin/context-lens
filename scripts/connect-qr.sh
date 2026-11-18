#!/usr/bin/env bash
# Make a connect code for ContextLens: a QR image and the same code as text, so a
# tester can connect the app to a Firebase project without setting one up. The tester
# scans or pastes it in Settings; nothing goes through a browser.
#
# Usage: scripts/connect-qr.sh <google-services.json> [out-dir]
#   default out-dir: ~/.config/context-lens (connect-qr.png and connect-code.txt, mode 600)
# The code carries the API key: the script refuses to write into any git checkout and
# never prints the key. Share the files only privately.
set -euo pipefail
TL_TAG=connect-qr
# shellcheck source=lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
need python3 "to read the configuration"
need git "to check that the output is outside any git checkout"

src="${1:-}"
[[ -n "$src" && -f "$src" ]] || die "usage: scripts/connect-qr.sh <google-services.json> [out-dir]"
umask 077
dir="${2:-$HOME/.config/context-lens}"
mkdir -p "$dir"
dir="$(cd "$dir" && pwd -P)"
root="$(cd "$TL_ROOT" && pwd -P)"
[[ "$dir" != "$root" && "$dir" != "$root"/* ]] || die "the code carries a key: write it outside the repository"
if git -C "$dir" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  die "the code carries a key: $dir is inside a git checkout"
fi
warn "keep $dir out of dotfile backups and repositories (e.g. a bare dotfiles repo): the files carry the API key"
png="$dir/connect-qr.png"; txt="$dir/connect-code.txt"
for f in "$png" "$txt"; do [[ ! -L "$f" ]] || die "$f is a symbolic link"; done

code="$(python3 - "$src" <<'PY'
import json, re, sys, urllib.parse
data = json.load(open(sys.argv[1]))
project = data["project_info"]["project_id"]
client = next((c for c in data["client"]
               if c["client_info"]["android_client_info"]["package_name"] == "com.contextlens.app"), None)
if client is None:
    sys.exit("the file has no com.contextlens.app client")
app = client["client_info"]["mobilesdk_app_id"]
key = client["api_key"][0]["current_key"]
ok = (re.fullmatch(r"[a-z][a-z0-9-]{4,28}[a-z0-9]", project) and project != "placeholder-project"
      and re.fullmatch(r"1:\d+:android:[0-9a-f]+", app) and re.fullmatch(r"AIza[0-9A-Za-z_-]{35}", key))
if not ok:
    sys.exit("the file has no usable com.contextlens.app client")
print("contextlens-connect:1?" + urllib.parse.urlencode({"project": project, "app": app, "key": key}))
PY
)"

# segno, pinned, in its own environment; the code goes in on stdin, not on a command line.
py="${CONNECT_QR_PYTHON:-}"
if [[ -z "$py" ]]; then
  venv="$HOME/.cache/context-lens/segno-1.6.6"
  if ! "$venv/bin/python" -c 'import segno' >/dev/null 2>&1; then
    rm -rf "$venv"
    python3 -m venv "$venv" >/dev/null
    "$venv/bin/pip" install --quiet "segno==1.6.6" || { rm -rf "$venv"; die "could not install segno 1.6.6"; }
  fi
  py="$venv/bin/python"
fi
printf '%s' "$code" | "$py" -c 'import sys, segno; segno.make(sys.stdin.read(), error="m").save(sys.argv[1], scale=8)' "$png"
printf '%s\n' "$code" > "$txt"
chmod 600 "$png" "$txt"
project="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["project_info"]["project_id"])' "$src")"
log "wrote $png and $txt for project $project (private: they carry the API key)"

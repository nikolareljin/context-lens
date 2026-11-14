#!/usr/bin/env bash
# Helpers for the cloud and phone setup scripts. Source after common.sh.
# Stand-ins for tests: FIREBASE, GCLOUD, GH, CURL, OPEN_URL, ASSUME_YES.
#
# Credentials never pass through these helpers' output: the Google access token
# is read into a local variable and handed to curl as a header file, and
# account names are tested for presence only.

TL_ENV_FILE="${TL_ENV_FILE:-$TL_ROOT/.env}"
TL_WEB_ENV="${TL_WEB_ENV:-$TL_ROOT/apps/web/.env.local}"
# shellcheck disable=SC2034  # used by the scripts that source this file
TL_PACKAGE="com.contextlens.app"

firebase_bin() { printf '%s' "${FIREBASE:-firebase}"; }
gcloud_bin()   { printf '%s' "${GCLOUD:-gcloud}"; }
gh_bin()       { printf '%s' "${GH:-gh}"; }
curl_bin()     { printf '%s' "${CURL:-curl}"; }

# env_set <file> <KEY> <value>: add or replace KEY=value; the file stays private.
env_set() {
  local file="$1" key="$2" value="$3" tmp
  [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || die "bad variable name: $key"
  [[ "$value" != *$'\n'* ]] || die "$key: value spans several lines"
  mkdir -p "$(dirname "$file")"
  [[ -f "$file" ]] || { : > "$file"; chmod 600 "$file"; }
  tmp="$(mktemp "$file.XXXXXX")"
  grep -v "^$key=" "$file" > "$tmp" || true
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$file"
  export "$key=$value"
}

# env_get <file> <KEY>: the value, or nothing.
env_get() {
  [[ -f "$1" ]] || return 0
  grep "^$2=" "$1" | tail -n 1 | cut -d= -f2-
}

# confirm <question>: yes when ASSUME_YES=1 or the user answers y.
confirm() {
  [[ "${ASSUME_YES:-0}" == 1 ]] && return 0
  local answer
  read -r -p "$1 [y/N] " answer < /dev/tty || return 1
  [[ "$answer" == [yY] || "$answer" == [yY][eE][sS] ]]
}

# pause <message>: wait for Enter (skipped with ASSUME_YES=1).
pause() {
  [[ "${ASSUME_YES:-0}" == 1 ]] && return 0
  read -r -p "$1 Press Enter when done. " _ < /dev/tty || true
}

# open_url <url>: open it in the browser, and print it for another machine.
open_url() {
  printf '  open: %s\n' "$1" >&2
  local opener="${OPEN_URL:-}"
  if [[ -z "$opener" ]]; then
    if command -v xdg-open >/dev/null 2>&1; then opener=xdg-open
    elif command -v open >/dev/null 2>&1; then opener=open
    else return 0; fi
  fi
  "$opener" "$1" >/dev/null 2>&1 &
}

# rand_hex <bytes>
rand_hex() { od -An -N"$1" -tx1 /dev/urandom | tr -d ' \n'; }

# project_id: the configured Firebase project, or fail with the next step.
project_id() {
  local id="${FIREBASE_PROJECT_ID:-$(env_get "$TL_ENV_FILE" FIREBASE_PROJECT_ID)}"
  [[ -n "$id" ]] || die "no Firebase project yet: run ./dev cloud project"
  printf '%s' "$id"
}

# api <METHOD> <url> [json]: an authenticated Google API call; prints the body.
api() {
  local method="$1" url="$2" body="${3:-}" token project
  project="$(project_id)"
  token="$("$(gcloud_bin)" auth print-access-token 2>/dev/null)" \
    || die "gcloud is not signed in: run ./dev cloud login"
  [[ -n "$token" ]] || die "gcloud returned no access token: run ./dev cloud login"
  local args=(-sS --fail-with-body -X "$method"
    -H "x-goog-user-project: $project" -H "Content-Type: application/json")
  [[ -n "$body" ]] && args+=(--data "$body")
  # the header file lives only for this command, so the token stays out of argv
  "$(curl_bin)" "${args[@]}" -H @<(printf 'Authorization: Bearer %s\n' "$token") "$url"
}

# github_repo: owner/name of the origin remote.
github_repo() {
  "$(gh_bin)" repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null \
    || die "gh cannot see this repository (gh auth login)"
}

# pages_domain: <owner>.github.io for the origin remote.
pages_domain() {
  local repo; repo="$(github_repo)"
  printf '%s.github.io' "$(printf '%s' "${repo%%/*}" | tr '[:upper:]' '[:lower:]')"
}

# qr_print <text>: a QR code in the terminal (qrencode, else segno in a local venv).
qr_print() {
  if command -v qrencode >/dev/null 2>&1; then
    qrencode -t ansiutf8 -m 2 "$1"; return
  fi
  local venv="${XDG_CACHE_HOME:-$HOME/.cache}/context-lens/qr-venv"
  if [[ ! -x "$venv/bin/python" ]]; then
    need python3 "or install qrencode"
    log "preparing a QR printer in $venv (one time)"
    if ! python3 -m venv "$venv" || ! "$venv/bin/pip" install -q segno; then
      die "could not install segno; install qrencode instead"
    fi
  fi
  "$venv/bin/python" -I -c 'import sys, segno; segno.make(sys.argv[1], error="m").terminal(compact=True)' "$1"
}

# mdns_pick <service> [name]: from `adb mdns services` on stdin, the ip:port of
# the first line whose service matches (and whose instance is name, if given).
mdns_pick() {
  awk -v svc="$1" -v name="${2:-}" 'index($2, svc) == 1 && (name == "" || $1 == name) { print $3; exit }'
}

# pairing_payload <name> <password>: the text Android's "Pair device with QR code" scans.
pairing_payload() { printf 'WIFI:T:ADB;S:%s;P:%s;;' "$1" "$2"; }

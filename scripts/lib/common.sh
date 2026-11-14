#!/usr/bin/env bash
# Shared helpers for the scripts behind ./dev. Source it; do not run it.

# Repository root, independent of the caller's directory.
TL_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export TL_ROOT

if [[ -t 2 && -z "${NO_COLOR:-}" ]]; then
  _c_red=$'\033[31m'; _c_yel=$'\033[33m'; _c_dim=$'\033[2m'; _c_off=$'\033[0m'
else
  _c_red=''; _c_yel=''; _c_dim=''; _c_off=''
fi

log()  { printf '%s[%s]%s %s\n' "$_c_dim" "${TL_TAG:-dev}" "$_c_off" "$*" >&2; }
warn() { printf '%s[%s] warning:%s %s\n' "$_c_yel" "${TL_TAG:-dev}" "$_c_off" "$*" >&2; }
die()  { printf '%s[%s] error:%s %s\n' "$_c_red" "${TL_TAG:-dev}" "$_c_off" "$*" >&2; exit "${2:-1}"; }

# need <command> [hint]: fail with a hint when a command is missing.
need() {
  command -v "$1" >/dev/null 2>&1 || die "$1 not found${2:+ ($2)}"
}

# load_env: read KEY=value lines from $TL_ROOT/.env without executing it.
# Variables already set in the environment win.
load_env() {
  local file="${1:-$TL_ROOT/.env}" line key value
  [[ -f "$file" ]] || return 0
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" == \#* ]] && continue
    key="${line%%=*}"; value="${line#*=}"
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    if [[ -z "${!key:-}" ]]; then
      export "$key=$value"
    fi
  done < "$file"
}

# version: the release version from VERSION.
version() { tr -d '[:space:]' < "$TL_ROOT/VERSION"; }

# is_semver <string>: strict MAJOR.MINOR.PATCH, no prefix.
is_semver() { [[ "$1" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]; }

# usage_from <file>: print the leading comment block of a script as help.
usage_from() {
  awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$1"
}

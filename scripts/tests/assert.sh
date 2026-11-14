#!/usr/bin/env bash
# Minimal assertions for the script tests. Source it.
# Each test is a function named test_*; run_tests calls them in a fresh
# temporary directory and reports. Temporary directories are removed only
# when they were created by mktemp under TMPDIR.

# shellcheck disable=SC2034  # used by the test files that source this one
TL_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
_fail=0; _count=0

fail() { echo "    FAIL: $*" >&2; _fail=$((_fail + 1)); }

assert_eq() {
  [[ "$1" == "$2" ]] || fail "${3:-values differ}: expected '$2', got '$1'"
}
assert_contains() {
  [[ "$1" == *"$2"* ]] || fail "${3:-missing text}: '$2' not in output: $1"
}
# assert_status <expected> <command...>: run the command, compare its status.
assert_status() {
  local want="$1"; shift
  local got=0
  "$@" >/dev/null 2>&1 || got=$?
  [[ "$got" == "$want" ]] || fail "status of '$*': expected $want, got $got"
}

_cleanup_dir() {
  local d="$1"
  case "$d" in "${TMPDIR:-/tmp}"/tltest.*) rm -rf -- "$d" ;; esac
}

run_tests() {
  local fn tmp
  for fn in $(declare -F | awk '{print $3}' | grep '^test_'); do
    _count=$((_count + 1))
    tmp="$(mktemp -d "${TMPDIR:-/tmp}/tltest.XXXXXX")"
    # the test runs in a subshell; its own failure count decides its status
    # shellcheck disable=SC2030,SC2031
    if ( cd "$tmp" && _fail=0 && "$fn" && [[ "$_fail" -eq 0 ]] ); then
      echo "  ok   $fn"
    else
      # shellcheck disable=SC2031
      _fail=$((_fail + 1)); echo "  FAIL $fn"
    fi
    _cleanup_dir "$tmp"
  done
  [[ "$_fail" -eq 0 ]]
}

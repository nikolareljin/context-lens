#!/usr/bin/env bash
# shellcheck disable=SC2329,SC2034,SC2016,SC2153,SC2238  # test functions are found by name
source "$(dirname "${BASH_SOURCE[0]}")/assert.sh"
source "$TL_ROOT/scripts/lib/common.sh"

test_semver_accepts_plain_versions() {
  is_semver 0.1.0 || fail "0.1.0"
  is_semver 10.20.30 || fail "10.20.30"
}
test_semver_refuses_prefix_and_leading_zero() {
  ! is_semver v0.1.0 || fail "v0.1.0 accepted"
  ! is_semver 0.01.0 || fail "0.01.0 accepted"
  ! is_semver 0.1 || fail "0.1 accepted"
  ! is_semver "0.1.0-rc1" || fail "pre-release accepted"
}
test_load_env_reads_without_executing() {
  printf 'TL_A=one\n# comment\nTL_B=$(touch pwned)\nnot a line\n' > env
  unset TL_A TL_B
  load_env "$PWD/env"
  assert_eq "$TL_A" one
  assert_eq "$TL_B" '$(touch pwned)'
  [[ ! -e pwned ]] || fail "value was executed"
}
test_load_env_keeps_existing_values() {
  printf 'TL_C=file\n' > env
  TL_C=shell load_env "$PWD/env"
  export TL_C=shell; load_env "$PWD/env"
  assert_eq "$TL_C" shell
}
test_usage_from_prints_header() {
  out="$(usage_from "$TL_ROOT/dev")"
  assert_contains "$out" "Usage: ./dev"
  [[ "$out" != *"set -euo"* ]] || fail "help ran past the comment block"
}
run_tests

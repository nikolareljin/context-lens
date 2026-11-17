#!/usr/bin/env bash
# shellcheck disable=SC2329  # test functions are found by name
source "$(dirname "${BASH_SOURCE[0]}")/assert.sh"
script="$TL_ROOT/scripts/firebase-config.sh"
placeholder="$TL_ROOT/scripts/ci/google-services.placeholder.json"

test_secret_is_decoded() {
  export TL_ANDROID_DIR="$PWD/android"
  json='{"project_info":{"project_id":"x"}}'
  GOOGLE_SERVICES_JSON_B64="$(printf '%s' "$json" | base64 -w0)" bash "$script" >/dev/null 2>&1 || fail "script failed"
  assert_eq "$(cat android/app/google-services.json)" "$json"
}
test_bad_secret_is_refused_and_removed() {
  export TL_ANDROID_DIR="$PWD/android"
  assert_status 1 env GOOGLE_SERVICES_JSON_B64="$(printf 'nope' | base64 -w0)" bash "$script"
  [[ ! -e android/app/google-services.json ]] || fail "bad file left behind"
}
test_placeholder_replaces_an_existing_file() {
  [[ -f "$placeholder" ]] || return 0
  export TL_ANDROID_DIR="$PWD/android"
  mkdir -p android/app && echo real > android/app/google-services.json
  bash "$script" --placeholder >/dev/null 2>&1 || fail "script failed"
  cmp -s "$placeholder" android/app/google-services.json || fail "a real file survived --placeholder"
}
test_existing_file_is_kept() {
  export TL_ANDROID_DIR="$PWD/android"
  mkdir -p android/app && echo keep > android/app/google-services.json
  GOOGLE_SERVICES_JSON_B64=eA== bash "$script" >/dev/null 2>&1
  assert_eq "$(cat android/app/google-services.json)" keep
}
test_placeholder_used_without_secret() {
  [[ -f "$placeholder" ]] || return 0   # placeholder arrives with the Firebase setup
  export TL_ANDROID_DIR="$PWD/android"
  env -u GOOGLE_SERVICES_JSON_B64 bash "$script" >/dev/null 2>&1 || fail "script failed"
  cmp -s "$placeholder" android/app/google-services.json || fail "placeholder not copied"
}
run_tests

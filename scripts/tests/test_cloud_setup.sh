#!/usr/bin/env bash
# shellcheck disable=SC2329,SC2016  # test functions are found by name
source "$(dirname "${BASH_SOURCE[0]}")/assert.sh"
cloud="$TL_ROOT/scripts/cloud-setup.sh"
phone="$TL_ROOT/scripts/phone-setup.sh"
DEBUG_ID="0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0"

# Every run works on files in the test directory, never the checkout's.
sandbox() {
  export TL_ENV_FILE="$PWD/dot.env" TL_WEB_ENV="$PWD/web.env" TL_ANDROID_DIR="$PWD/android"
  export FIREBASE_PROJECT_ID="" ASSUME_YES=1 OPEN_URL=true WAIT_SECONDS=2
  mkdir -p android/app
}
stub() { printf '#!/usr/bin/env bash\n%s\n' "$2" > "$1"; chmod +x "$1"; }
fake_gcloud() { stub gcloud 'if [[ "$1 $2" == "auth print-access-token" ]]; then echo SECRET-ACCESS; fi'; export GCLOUD="$PWD/gcloud"; }

lib() { ( source "$TL_ROOT/scripts/lib/common.sh"; source "$TL_ROOT/scripts/lib/cloud.sh"; "$@" ); }

test_env_set_adds_replaces_and_keeps_the_file_private() {
  lib env_set "$PWD/e" A 1
  lib env_set "$PWD/e" B 2
  lib env_set "$PWD/e" A 3
  assert_eq "$(cat e)" $'B=2\nA=3'
  assert_eq "$(stat -c %a e)" 600
  assert_eq "$(lib env_get "$PWD/e" A)" 3
}
test_env_get_of_a_missing_key_is_empty_and_succeeds() {
  echo A=1 > e
  out="$(set -o pipefail; lib env_get "$PWD/e" B)" || fail "env_get failed for a missing key"
  assert_eq "$out" ""
}
test_project_less_steps_stop_with_a_hint() {
  sandbox; fake_gcloud; stub firebase 'echo "firebase $*" >> '"$PWD"'/fb-calls'
  export FIREBASE="$PWD/firebase"
  out="$(bash "$cloud" web 2>&1 || true)"
  assert_contains "$out" "no Firebase project yet"
  [[ ! -f fb-calls ]] || fail "firebase ran without a project: $(cat fb-calls)"
}
test_yes_does_not_mark_ai_logic_ready() {
  sandbox; echo FIREBASE_PROJECT_ID=demo-proj > dot.env
  stub gcloud 'echo firebasevertexai.googleapis.com'; export GCLOUD="$PWD/gcloud"
  bash "$cloud" apis >/dev/null 2>&1 || true
  [[ "$(cat dot.env)" != *AI_LOGIC_READY* ]] || fail "AI Logic marked ready without confirmation"
}
test_env_set_refuses_bad_names() {
  assert_status 1 lib env_set "$PWD/e" "1A" x
}
test_pairing_payload_is_the_adb_qr_format() {
  assert_eq "$(lib pairing_payload studio-x pw)" "WIFI:T:ADB;S:studio-x;P:pw;;"
}
test_mdns_pick_matches_service_and_name() {
  local list=$'adb-R5X-aa\t_adb-tls-connect._tcp\t10.0.0.5:37001\ncontextlens-ab\t_adb-tls-pairing._tcp\t10.0.0.5:41000'
  assert_eq "$(printf '%s\n' "$list" | lib mdns_pick _adb-tls-pairing contextlens-ab)" "10.0.0.5:41000"
  assert_eq "$(printf '%s\n' "$list" | lib mdns_pick _adb-tls-pairing other)" ""
  assert_eq "$(printf '%s\n' "$list" | lib mdns_pick _adb-tls-connect)" "10.0.0.5:37001"
}
test_unknown_steps_exit_2() {
  assert_status 2 bash "$cloud" nope
  assert_status 2 bash "$phone" nope
}
test_status_lists_what_is_left() {
  sandbox; export FIREBASE="$PWD/missing-fb" GCLOUD="$PWD/missing-gc"
  out="$(bash "$cloud" status 2>&1)"
  assert_contains "$out" "todo     Firebase CLI"
  assert_contains "$out" "todo     FIREBASE_PROJECT_ID"
}
test_web_step_writes_the_local_env_without_printing_values() {
  sandbox; fake_gcloud
  echo FIREBASE_PROJECT_ID=demo-proj > dot.env
  stub firebase 'echo "{\"result\":[{\"appId\":\"1:9:web:abc\",\"displayName\":\"ContextLens web\"}]}"'
  stub curl 'for a in "$@"; do [[ "$a" == @/dev/fd/* ]] && cat "${a#@}" >> '"$PWD"'/headers; done
echo "{\"apiKey\":\"AIzaFAKE\",\"authDomain\":\"demo-proj.firebaseapp.com\",\"projectId\":\"demo-proj\",\"appId\":\"1:9:web:abc\",\"messagingSenderId\":\"9\"}"'
  export FIREBASE="$PWD/firebase" CURL="$PWD/curl"
  out="$(bash "$cloud" web 2>&1)" || fail "web step failed: $out"
  assert_contains "$(cat web.env)" "VITE_FIREBASE_API_KEY=AIzaFAKE"
  assert_contains "$(cat web.env)" "VITE_FIREBASE_MESSAGING_SENDER_ID=9"
  assert_contains "$(cat dot.env)" "FIREBASE_WEB_APP_ID=1:9:web:abc"
  assert_contains "$(cat headers)" "Authorization: Bearer SECRET-ACCESS"
  [[ "$out" != *AIzaFAKE* && "$out" != *SECRET-ACCESS* ]] || fail "a value was printed: $out"
}
test_github_step_sets_variables_and_secrets_from_stdin() {
  sandbox
  echo FIREBASE_PROJECT_ID=demo-proj > dot.env; echo FIREBASE_ANDROID_APP_ID=1:9:android:x >> dot.env
  echo '{"project_info":{}}' > android/app/google-services.json
  local n
  for n in API_KEY AUTH_DOMAIN PROJECT_ID APP_ID MESSAGING_SENDER_ID; do echo "VITE_FIREBASE_$n=v-$n" >> web.env; done
  echo VITE_RECAPTCHA_SITE_KEY=site-key >> web.env
  stub gh 'if [[ "$1" == repo ]]; then echo Owner/context-lens; exit; fi
printf "%s %s %s=%s\n" "$1" "$2" "$3" "$(cat)" >> '"$PWD"'/gh-calls'
  export GH="$PWD/gh"
  out="$(bash "$cloud" github 2>&1)" || fail "github step failed: $out"
  calls="$(cat gh-calls)"
  assert_contains "$calls" "variable set VITE_FIREBASE_API_KEY=v-API_KEY"
  assert_contains "$calls" "variable set VITE_RECAPTCHA_SITE_KEY=site-key"
  assert_contains "$calls" "variable set FIREBASE_PROJECT_ID=demo-proj"
  assert_contains "$calls" "secret set GOOGLE_SERVICES_JSON_B64=$(base64 -w0 android/app/google-services.json)"
  assert_contains "$calls" "secret set FIREBASE_ANDROID_APP_ID=1:9:android:x"
  [[ "$out" != *v-API_KEY* ]] || fail "a value was printed: $out"
}
test_phone_token_is_registered_but_never_printed() {
  sandbox; fake_gcloud
  printf 'FIREBASE_PROJECT_ID=demo-proj\nFIREBASE_ANDROID_APP_ID=1:9:android:x\n' > dot.env
  stub adb 'case "$*" in
  devices*) printf "List of devices attached\nR5X\tdevice\n" ;;
  *"pm list packages"*) echo package:com.contextlens.app ;;
  *"getprop ro.product.model"*) echo "Galaxy Test" ;;
  *"logcat -d"*) echo "I DebugAppCheckProvider: Enter this debug secret into the allow list in the Firebase Console for your project: '"$DEBUG_ID"'" ;;
esac'
  stub curl 'echo "$*" >> '"$PWD"'/argv; cat >> '"$PWD"'/bodies; echo >> '"$PWD"'/bodies; echo "{}"'
  export ADB="$PWD/adb" CURL="$PWD/curl"
  out="$(bash "$phone" token 2>&1)" || fail "token step failed: $out"
  assert_contains "$(cat bodies)" "\"token\":\"$DEBUG_ID\""
  assert_contains "$(cat bodies)" "\"displayName\":\"Galaxy Test debug\""
  assert_contains "$out" "registered as 'Galaxy Test debug'"
  [[ "$out" != *"$DEBUG_ID"* ]] || fail "the token was printed: $out"
  [[ "$(cat argv)" != *"$DEBUG_ID"* ]] || fail "the token was in curl's argv"
}
test_phone_token_matches_the_current_sdk_wording() {
  sandbox; fake_gcloud
  printf 'FIREBASE_PROJECT_ID=demo-proj\nFIREBASE_ANDROID_APP_ID=1:9:android:x\n' > dot.env
  stub adb 'case "$*" in
  devices*) printf "List of devices attached\nR5X\tdevice\n" ;;
  *"pm list packages"*) echo package:com.contextlens.app ;;
  *"getprop ro.product.model"*) echo "Galaxy Test" ;;
  *"logcat -d"*) echo "W FirebaseAppCheck: Debug token was rejected by server. Register it with: firebase appcheck:debugtokens:create '"$DEBUG_ID"' --project demo-proj" ;;
esac'
  stub curl 'cat >> '"$PWD"'/bodies; echo "{}"'
  export ADB="$PWD/adb" CURL="$PWD/curl"
  out="$(bash "$phone" token 2>&1)" || fail "token step failed: $out"
  assert_contains "$(cat bodies)" "\"token\":\"$DEBUG_ID\""
}
test_phone_status_reports_aicore_from_a_long_dumpsys() {
  sandbox
  stub adb 'case "$*" in
  devices*) printf "List of devices attached\nR5X\tdevice\n" ;;
  *"dumpsys package"*) echo "    versionName=1.2.3"; seq 1 20000 ;;
  *"getprop ro.product.model"*) echo "Galaxy Test" ;;
esac'
  export ADB="$PWD/adb"
  out="$(bash "$phone" status 2>&1)" || fail "status failed: $out"
  assert_contains "$out" "AICore 1.2.3"
  assert_contains "$out" "ContextLens"
}
test_phone_pair_skips_when_a_phone_is_connected() {
  sandbox
  stub adb 'case "$*" in devices*) printf "List of devices attached\nR5X\tdevice\n" ;; *) echo "adb $*" >> '"$PWD"'/adb-calls ;; esac'
  export ADB="$PWD/adb"
  out="$(bash "$phone" pair 2>&1)" || fail "pair failed: $out"
  assert_contains "$out" "already connected"
  [[ ! -f adb-calls ]] || fail "pair ran adb commands: $(cat adb-calls)"
}

run_tests

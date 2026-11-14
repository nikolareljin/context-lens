#!/usr/bin/env bash
# shellcheck disable=SC2329,SC2016  # test functions are found by name
source "$(dirname "${BASH_SOURCE[0]}")/assert.sh"
script="$TL_ROOT/scripts/phone-install.sh"

# fake_adb <devices lines>: answers `adb devices`, records every other call
fake_adb() {
  printf '#!/usr/bin/env bash\nif [[ "$1" == devices ]]; then echo "List of devices attached"; printf "%%b" "%s"; exit 0; fi\necho "adb $*" >> "%s/adb-calls"\n' "$1" "$PWD" > adb
  chmod +x adb; export ADB="$PWD/adb"
}
# fake_curl: writes the requested URL into the -o file, records it
fake_curl() {
  printf '#!/usr/bin/env bash\nout=""; url=""\nwhile [[ $# -gt 0 ]]; do case "$1" in -o) out="$2"; shift 2 ;; -*) shift ;; *) url="$1"; shift ;; esac; done\necho "$url" >> "%s/curl-calls"\necho "apk from $url" > "$out"\n' "$PWD" > curl
  chmod +x curl; export CURL="$PWD/curl" TOOLS_DIR="$PWD/tools" WAIT_SECONDS=1
}

test_latest_release_uses_the_fixed_asset() {
  fake_curl; fake_adb 'R5X\\tdevice\\n'
  bash "$script" >/dev/null 2>&1 || fail "install failed"
  assert_contains "$(cat curl-calls)" "/releases/latest/download/context-lens.apk"
  assert_contains "$(cat adb-calls)" "-s R5X install -r $PWD/tools/context-lens.apk"
  assert_contains "$(cat adb-calls)" "-s R5X shell am start -n com.contextlens.app/.MainActivity"
}
test_a_version_uses_its_release() {
  fake_curl; fake_adb 'R5X\\tdevice\\n'
  bash "$script" --version 0.2.0 >/dev/null 2>&1 || fail "install failed"
  assert_contains "$(cat curl-calls)" "/releases/download/0.2.0/contextlens-0.2.0.apk"
}
test_a_local_apk_is_not_downloaded() {
  fake_curl; fake_adb 'R5X\\tdevice\\n'
  echo apk > mine.apk
  bash "$script" --apk mine.apk >/dev/null 2>&1 || fail "install failed"
  [[ ! -f curl-calls ]] || fail "downloaded although --apk was given"
  assert_contains "$(cat adb-calls)" "install -r mine.apk"
}
test_bad_version_is_refused() {
  fake_curl; fake_adb ''
  assert_status 1 bash "$script" --version v1
}
test_unknown_option_exits_2() {
  assert_status 2 bash "$script" --nope
}
test_no_phone_fails_with_a_hint() {
  fake_curl; fake_adb 'R5X\\tunauthorized\\n'
  out="$(bash "$script" 2>&1 || true)"
  assert_contains "$out" "no phone found"
}
test_two_phones_need_a_serial() {
  fake_curl; fake_adb 'A1\\tdevice\\nB2\\tdevice\\n'
  out="$(bash "$script" 2>&1 || true)"
  assert_contains "$out" "set ANDROID_SERIAL"
  ANDROID_SERIAL=B2 bash "$script" >/dev/null 2>&1 || fail "install with a serial failed"
  assert_contains "$(cat adb-calls)" "-s B2 install"
}
test_failed_download_is_reported() {
  printf '#!/usr/bin/env bash\nexit 22\n' > curl; chmod +x curl
  export CURL="$PWD/curl" TOOLS_DIR="$PWD/tools" WAIT_SECONDS=1
  fake_adb 'R5X\\tdevice\\n'
  out="$(bash "$script" 2>&1 || true)"
  assert_contains "$out" "download failed"
}
run_tests

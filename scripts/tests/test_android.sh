#!/usr/bin/env bash
# shellcheck disable=SC2329,SC2016  # test functions are found by name
source "$(dirname "${BASH_SOURCE[0]}")/assert.sh"
script="$TL_ROOT/scripts/android.sh"

fake_adb() {
  # $1: lines for `adb devices -l` after the header
  printf '#!/usr/bin/env bash\nif [[ "$1" == devices ]]; then echo "List of devices attached"; printf "%%b" "%s"; exit 0; fi\necho "adb $*" >> "%s/adb-calls"\n' "$1" "$PWD" > adb
  chmod +x adb; export ADB="$PWD/adb"
}
fake_android() {
  mkdir -p android/app/build/outputs/apk/debug
  touch android/app/build/outputs/apk/debug/app-debug.apk
  printf '#!/usr/bin/env bash\necho "gradle $*" >> "%s/gradle-calls"\n' "$PWD" > android/gradlew
  chmod +x android/gradlew
  export TL_ANDROID_DIR="$PWD/android" GRADLEW="$PWD/android/gradlew"
}

test_missing_app_is_reported() {
  export TL_ANDROID_DIR="$PWD/none"; unset GRADLEW
  out="$(bash "$script" build 2>&1 || true)"
  assert_contains "$out" "apps/android is not present yet"
}
test_build_runs_assemble() {
  fake_android
  bash "$script" build >/dev/null 2>&1 || fail "build failed"
  assert_contains "$(cat gradle-calls)" ":app:assembleDebug"
}
test_release_apk_needs_signing() {
  fake_android
  assert_status 1 env -u ANDROID_KEYSTORE_PATH bash "$script" apk release
}
test_install_single_device() {
  fake_android; fake_adb 'R5X\\tdevice usb:1\\n'
  bash "$script" install >/dev/null 2>&1 || fail "install failed"
  assert_contains "$(cat adb-calls)" "-s R5X install -r"
  # an existing APK is rebuilt, never installed as it is
  assert_contains "$(cat gradle-calls)" ":app:assembleDebug"
}
test_install_no_device_fails() {
  fake_android; fake_adb 'R5X\\tunauthorized\\n'
  out="$(bash "$script" install 2>&1 || true)"
  assert_contains "$out" "no device ready"
}
test_install_pick_among_several() {
  fake_android; fake_adb 'A1\\tdevice\\nB2\\tdevice\\n'
  ANDROID_PICK=2 bash "$script" install >/dev/null 2>&1 || fail "install failed"
  assert_contains "$(cat adb-calls)" "-s B2 install"
}
run_tests

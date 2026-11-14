#!/usr/bin/env bash
# Android build, test and device tasks.
#
# Usage: scripts/android.sh <command>
#   build            assemble the debug APK
#   test             JVM unit tests
#   lint             Android lint
#   apk [debug|release]   build an APK; release needs signing variables (see .env.example)
#   install          install the debug APK on one device and launch it
#   smoke            boot an emulator headless, install, launch, screenshot, shut down
#
# Environment: ANDROID_HOME, ANDROID_SERIAL, ANDROID_PICK, ANDROID_AVD (smoke),
# stand-ins GRADLEW, ADB, EMULATOR for tests.
set -euo pipefail
TL_TAG=android
# shellcheck source=lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
# shellcheck source=lib/android.sh
source "$TL_ROOT/scripts/lib/android.sh"
load_env

APP_ID="com.contextlens.app"
DEBUG_APK="app/build/outputs/apk/debug/app-debug.apk"

cmd="${1:-}"; shift || true
case "$cmd" in
  build) gradle :app:assembleDebug ;;
  test)  gradle :app:testDebugUnitTest ;;
  lint)  gradle :app:lintDebug ;;
  apk)
    variant="${1:-debug}"
    case "$variant" in
      debug) gradle :app:assembleDebug ;;
      release)
        for v in ANDROID_KEYSTORE_PATH ANDROID_KEY_ALIAS ANDROID_KEYSTORE_PASSWORD ANDROID_KEY_PASSWORD; do
          [[ -n "${!v:-}" ]] || die "$v is not set (release signing)"
        done
        [[ -f "$ANDROID_KEYSTORE_PATH" ]] || die "keystore not found: $ANDROID_KEYSTORE_PATH"
        gradle :app:assembleRelease :app:bundleRelease ;;
      *) die "apk variant must be debug or release" ;;
    esac ;;
  install)
    require_android
    serial="$(pick_device)"
    [[ -f "$TL_ANDROID_DIR/$DEBUG_APK" ]] || gradle :app:assembleDebug
    "$(adb_bin)" -s "$serial" install -r "$TL_ANDROID_DIR/$DEBUG_APK"
    "$(adb_bin)" -s "$serial" shell monkey -p "$APP_ID" -c android.intent.category.LAUNCHER 1 >/dev/null
    log "installed and launched on $serial" ;;
  smoke)
    require_android
    avd="${ANDROID_AVD:-Pixel_3a_API_30_x86}"
    emulator="${EMULATOR:-$(android_home)/emulator/emulator}"
    adb="$(adb_bin)"
    [[ -f "$TL_ANDROID_DIR/$DEBUG_APK" ]] || gradle :app:assembleDebug
    "$emulator" -avd "$avd" -no-window -no-audio -no-snapshot -no-boot-anim >/dev/null 2>&1 &
    emu_pid=$!
    trap 'kill "$emu_pid" 2>/dev/null || true' EXIT
    "$adb" wait-for-device
    for _ in $(seq 1 120); do
      kill -0 "$emu_pid" 2>/dev/null || die "emulator exited during boot"
      [[ "$("$adb" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == 1 ]] && break
      sleep 2
    done
    serial="$("$adb" devices | awk '/^emulator-/ {print $1; exit}')"
    [[ -n "$serial" ]] || die "emulator did not come up"
    "$adb" -s "$serial" install -r "$TL_ANDROID_DIR/$DEBUG_APK"
    # -W returns once the first frame is drawn; a fixed sleep caught a blank window on slow emulators
    "$adb" -s "$serial" shell am start -W -n "$APP_ID/.MainActivity" >/dev/null
    sleep 3
    "$adb" -s "$serial" shell pidof "$APP_ID" >/dev/null || die "app is not running after launch"
    mkdir -p "$TL_ANDROID_DIR/app/build/smoke"
    "$adb" -s "$serial" exec-out screencap -p > "$TL_ANDROID_DIR/app/build/smoke/launch.png"
    "$adb" -s "$serial" emu kill >/dev/null 2>&1 || true
    log "smoke passed on $avd (screenshot: apps/android/app/build/smoke/launch.png)" ;;
  ""|-h|--help) usage_from "${BASH_SOURCE[0]}" ;;
  *) die "unknown command: $cmd (try --help)" ;;
esac

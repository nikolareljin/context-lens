#!/usr/bin/env bash
# Android toolchain helpers. Source after common.sh.
# Stand-ins for tests: GRADLEW, ADB, EMULATOR.

TL_ANDROID_DIR="${TL_ANDROID_DIR:-$TL_ROOT/apps/android}"

android_home() {
  local home="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}}"
  printf '%s' "$home"
}

android_present() { [[ -x "${GRADLEW:-$TL_ANDROID_DIR/gradlew}" ]]; }

require_android() {
  android_present || die "apps/android is not present yet (no gradlew)"
}

gradle() {
  require_android
  local home; home="$(android_home)"
  ( cd "$TL_ANDROID_DIR" && ANDROID_HOME="$home" "${GRADLEW:-./gradlew}" --console=plain "$@" )
}

adb_bin() {
  if [[ -n "${ADB:-}" ]]; then printf '%s' "$ADB"; return; fi
  local home; home="$(android_home)"
  if [[ -x "$home/platform-tools/adb" ]]; then printf '%s' "$home/platform-tools/adb"
  else printf 'adb'; fi
}

# pick_device: print one ready device serial. ANDROID_SERIAL wins; with
# several devices ANDROID_PICK=<n> chooses, else the user is asked.
pick_device() {
  local adb serials=() line n
  adb="$(adb_bin)"
  if [[ -n "${ANDROID_SERIAL:-}" ]]; then printf '%s' "$ANDROID_SERIAL"; return; fi
  while IFS= read -r line; do
    [[ "$line" == *$'\tdevice' || "$line" =~ [[:space:]]device([[:space:]]|$) ]] || continue
    serials+=("${line%%[[:space:]]*}")
  done < <("$adb" devices -l | tail -n +2)
  case "${#serials[@]}" in
    0) die "no device ready: connect a phone with USB debugging allowed, or start an emulator" ;;
    1) printf '%s' "${serials[0]}" ;;
    *)
      if [[ -n "${ANDROID_PICK:-}" ]]; then n="$ANDROID_PICK"
      else
        local i=1 s
        for s in "${serials[@]}"; do echo "  $i) $s" >&2; i=$((i + 1)); done
        read -r -p "device number: " n < /dev/tty
      fi
      [[ "$n" =~ ^[0-9]+$ && "$n" -ge 1 && "$n" -le "${#serials[@]}" ]] || die "no such device: $n"
      printf '%s' "${serials[$((n - 1))]}" ;;
  esac
}

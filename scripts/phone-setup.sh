#!/usr/bin/env bash
# Prepare an Android phone for ContextLens development.
#
# Usage: scripts/phone-setup.sh [step] [--yes]
#   all       pair (unless a phone is already connected), prep, token (default)
#   pair      wireless debugging by QR code: the phone scans it, no cable needed
#             (Android 11+, phone and computer on the same Wi-Fi)
#   usb       wait for a phone on USB with USB debugging allowed
#   prep      check the phone: Android version, a Google account (opens
#             "Add account" on the phone when there is none), AICore / Gemini Nano
#   token     run the debug app, read its App Check debug token from the log and
#             register it in Firebase (the token itself is never printed)
#   status    the connected phone and what is ready on it
#
# Stand-ins for tests: ADB (see scripts/lib/android.sh), WAIT_SECONDS.
set -euo pipefail
shopt -s inherit_errexit
TL_TAG=phone
# shellcheck source=lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
# shellcheck source=lib/android.sh
source "$TL_ROOT/scripts/lib/android.sh"
# shellcheck source=lib/cloud.sh
source "$TL_ROOT/scripts/lib/cloud.sh"
load_env

ADB_CMD="$(adb_bin)"
WAIT="${WAIT_SECONDS:-120}"
AC="https://firebaseappcheck.googleapis.com/v1"
AICORE="com.google.android.aicore"

step="all"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes) export ASSUME_YES=1 ;;
    -h|--help) usage_from "${BASH_SOURCE[0]}"; exit 0 ;;
    -*) die "unknown option: $1" 2 ;;
    *) step="$1" ;;
  esac
  shift
done

done_msg() { printf '  done     %s\n' "$*" >&2; }
ready_count() { "$ADB_CMD" devices | tail -n +2 | grep -c $'\tdevice$' || true; }

mdns_addr() { { "$ADB_CMD" mdns services 2>/dev/null || true; } | mdns_pick "$@"; }

step_pair() {
  if [[ "$(ready_count)" -gt 0 ]]; then done_msg "a phone is already connected"; return; fi
  local name pass addr i
  name="contextlens-$(rand_hex 3)"; pass="$(rand_hex 6)"
  cat >&2 <<EOF
On the phone:
  1. Settings → About phone → tap "Build number" 7 times (once; enables Developer options)
  2. Settings → Developer options → Wireless debugging → On
  3. Tap "Pair device with QR code" and scan this:
EOF
  qr_print "$(pairing_payload "$name" "$pass")" >&2
  log "waiting up to ${WAIT}s for the phone"
  addr=""
  for ((i = 0; i < WAIT; i += 2)); do
    addr="$(mdns_addr _adb-tls-pairing "$name")"
    [[ -n "$addr" ]] && break
    sleep 2
  done
  [[ -n "$addr" ]] || die "the phone did not answer; same Wi-Fi? (or use: ./dev phone usb)"
  "$ADB_CMD" pair "$addr" "$pass" >/dev/null || die "pairing failed"
  done_msg "paired"
  local ip="${addr%:*}"
  for ((i = 0; i < 30; i += 2)); do
    [[ "$(ready_count)" -gt 0 ]] && { done_msg "connected over Wi-Fi"; return; }
    # the paired phone's connect service: same address, another port
    addr="$({ "$ADB_CMD" mdns services 2>/dev/null || true; } \
      | awk -v ip="$ip" 'index($2, "_adb-tls-connect") == 1 && index($3, ip ":") == 1 { print $3; exit }')"
    if [[ -n "$addr" ]]; then "$ADB_CMD" connect "$addr" >/dev/null 2>&1 || true; fi
    sleep 2
  done
  die "paired but not connected; toggle Wireless debugging off and on, then: ./dev phone status"
}

step_usb() {
  cat >&2 <<EOF
On the phone: Developer options → USB debugging → On, plug in the cable,
and tap "Allow" on the "Allow USB debugging?" prompt.
EOF
  local i
  for ((i = 0; i < WAIT; i += 2)); do
    [[ "$(ready_count)" -gt 0 ]] && { done_msg "phone connected"; return; }
    sleep 2
  done
  die "no phone after ${WAIT}s (run: adb devices)"
}

sh_() { { "$ADB_CMD" -s "$DEVICE" shell "$@" 2>/dev/null || true; } | tr -d '\r'; }
google_accounts() { sh_ dumpsys account | grep -c 'type=com.google}' || true; }
aicore_version() { sh_ dumpsys package "$AICORE" | awk -F= '/versionName=/ {print $2; exit}'; }

step_prep() {
  DEVICE="$(pick_device)"
  local sdk model; sdk="$(sh_ getprop ro.build.version.sdk)"; model="$(sh_ getprop ro.product.model)"
  done_msg "$model, Android API $sdk"
  [[ "${sdk:-0}" -ge 31 ]] || warn "ContextLens needs Android 12 (API 31) or newer"
  if [[ "$(google_accounts)" -eq 0 ]]; then
    log "no Google account on the phone: the 'Add account' screen opens on the phone; sign in there"
    sh_ am start -a android.settings.ADD_ACCOUNT_SETTINGS >/dev/null
    pause "Signed in on the phone?"
    [[ "$(google_accounts)" -gt 0 ]] || warn "still no Google account (Play services and Gemini Nano need one)"
  fi
  if [[ "$(google_accounts)" -gt 0 ]]; then done_msg "Google account present"; fi
  local v; v="$(aicore_version)"
  if [[ -n "$v" ]]; then done_msg "AICore $v (update it if Diagnostics reports the model unavailable)"
  else warn "AICore is not installed: Gemini Nano is not offered on this phone; the cloud tier still works"; fi
  if [[ -n "$v" ]] && confirm "Open AICore in the Play Store on the phone to check for updates?"; then
    sh_ am start -a android.intent.action.VIEW -d "market://details?id=$AICORE" >/dev/null
  fi
}

step_token() {
  DEVICE="$(pick_device)"
  local p app; p="$(project_id)"
  app="$(env_get "$TL_ENV_FILE" FIREBASE_ANDROID_APP_ID)"
  [[ -n "$app" ]] || die "no Android app registered: run ./dev cloud android"
  if [[ -z "$(sh_ pm list packages "$TL_PACKAGE")" ]]; then
    log "installing the debug app"
    ANDROID_SERIAL="$DEVICE" bash "$TL_ROOT/scripts/android.sh" install
  fi
  "$ADB_CMD" -s "$DEVICE" logcat -c
  sh_ am force-stop "$TL_PACKAGE"
  sh_ am start -n "$TL_PACKAGE/.MainActivity" >/dev/null
  local token="" i
  for ((i = 0; i < 30; i += 2)); do
    token="$("$ADB_CMD" -s "$DEVICE" logcat -d 2>/dev/null \
      | grep -i 'debug secret' | grep -oE '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}' \
      | tail -n 1 || true)"
    [[ -n "$token" ]] && break
    sleep 2
  done
  [[ -n "$token" ]] || die "no App Check debug token in the log (is this a debug build with Firebase configured?)"
  local label; label="$(sh_ getprop ro.product.model) debug"
  local existing; existing="$(api GET "$AC/projects/$p/apps/$app/debugTokens" | jq -r '.debugTokens[]?.displayName')"
  if printf '%s\n' "$existing" | grep -qxF -- "$label"; then
    done_msg "a debug token named '$label' is registered already (delete it in the console to replace it)"
    return
  fi
  # the token reaches jq and curl through the environment and stdin, never argv
  api POST "$AC/projects/$p/apps/$app/debugTokens" \
    "$(CL_NAME="$label" CL_TOKEN="$token" jq -nc '{displayName: env.CL_NAME, token: env.CL_TOKEN}')" >/dev/null
  done_msg "App Check debug token registered as '$label'"
}

line() { printf '  %-8s %s\n' "$1" "$2"; }
step_status() {
  "$ADB_CMD" devices -l | tail -n +2 | sed '/^$/d; s/^/  /' >&2
  [[ "$(ready_count)" -gt 0 ]] || { log "no phone connected (./dev phone pair or ./dev phone usb)"; return; }
  DEVICE="$(pick_device)"
  line ok "$(sh_ getprop ro.product.model), API $(sh_ getprop ro.build.version.sdk)"
  if [[ "$(google_accounts)" -gt 0 ]]; then line ok "Google account"; else line todo "Google account (./dev phone prep)"; fi
  local v; v="$(aicore_version)"
  if [[ -n "$v" ]]; then line ok "AICore $v"; else line none "AICore (no Gemini Nano on this phone)"; fi
  if [[ -n "$(sh_ pm list packages "$TL_PACKAGE")" ]]; then line ok "ContextLens installed"
  else line todo "ContextLens (./dev install)"; fi
}

case "$step" in
  all)
    [[ "$(ready_count)" -gt 0 ]] || step_pair
    step_prep; step_token ;;
  pair|usb|prep|token|status) "step_$step" ;;
  *) die "unknown step: $step (try --help)" 2 ;;
esac

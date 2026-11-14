#!/usr/bin/env bash
# Install ContextLens on an Android phone over USB, from a computer with nothing else set up.
#
# Usage: scripts/phone-install.sh [--version X.Y.Z | --apk FILE]
#   (no option)        the newest release's APK
#   --version X.Y.Z    that release's APK
#   --apk FILE         an APK you already have
#
# Finds adb, or downloads Google's platform-tools (about 10 MB) into ~/.context-lens/,
# downloads the APK from the GitHub release, waits for one phone with USB debugging on,
# installs over any older copy and opens the app. No JDK, Android SDK or clone build needed.
# Runs on Linux, macOS and WSL.
#
# Environment (tests and unusual machines): ADB, CURL, UNZIP, TOOLS_DIR, DOWNLOAD_BASE, PACKAGE,
# PLATFORM_TOOLS, WAIT_SECONDS.
set -euo pipefail

REPO="nikolareljin/context-lens"
DOWNLOAD_BASE="${DOWNLOAD_BASE:-https://github.com/$REPO/releases}"
PACKAGE="${PACKAGE:-com.contextlens.app}"
TOOLS_DIR="${TOOLS_DIR:-$HOME/.context-lens}"
PLATFORM_TOOLS="${PLATFORM_TOOLS:-https://dl.google.com/android/repository/platform-tools-latest}"
CURL="${CURL:-curl}"
UNZIP="${UNZIP:-unzip}"
WAIT_SECONDS="${WAIT_SECONDS:-120}"

say() { printf 'phone-install: %s\n' "$*"; }
fail() { printf 'phone-install: %s\n' "$*" >&2; exit 1; }

version=""
apk=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) version="${2:-}"; [[ -n "$version" ]] || fail "--version needs X.Y.Z"; shift 2 ;;
    --apk) apk="${2:-}"; [[ -n "$apk" ]] || fail "--apk needs a file"; shift 2 ;;
    -h|--help) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) printf 'phone-install: unknown option %s (try --help)\n' "$1" >&2; exit 2 ;;
  esac
done
[[ -z "$version" || "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "not a version: $version"
[[ -z "$version" || -z "$apk" ]] || fail "use --version or --apk, not both"

# adb: $ADB, then PATH, then the Android SDK, then a private copy of platform-tools.
find_adb() {
  if [[ -n "${ADB:-}" ]]; then printf '%s' "$ADB"; return; fi
  if command -v adb >/dev/null 2>&1; then command -v adb; return; fi
  local sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}}"
  if [[ -x "$sdk/platform-tools/adb" ]]; then printf '%s' "$sdk/platform-tools/adb"; return; fi
  if [[ -x "$TOOLS_DIR/platform-tools/adb" ]]; then printf '%s' "$TOOLS_DIR/platform-tools/adb"; return; fi
  local os
  case "$(uname -s)" in
    Linux) os=linux ;;
    Darwin) os=darwin ;;
    *) fail "no adb found; install Android platform-tools" ;;
  esac
  say "downloading Android platform-tools into $TOOLS_DIR"
  mkdir -p "$TOOLS_DIR"
  "$CURL" -fsSL -o "$TOOLS_DIR/platform-tools.zip" "$PLATFORM_TOOLS-$os.zip" || fail "platform-tools download failed"
  "$UNZIP" -qo "$TOOLS_DIR/platform-tools.zip" -d "$TOOLS_DIR" || fail "could not unpack platform-tools"
  rm -f "$TOOLS_DIR/platform-tools.zip"
  [[ -x "$TOOLS_DIR/platform-tools/adb" ]] || fail "platform-tools has no adb"
  printf '%s' "$TOOLS_DIR/platform-tools/adb"
}

adb="$(find_adb)"

if [[ -z "$apk" ]]; then
  if [[ -n "$version" ]]; then
    url="$DOWNLOAD_BASE/download/$version/contextlens-$version.apk"
  else
    url="$DOWNLOAD_BASE/latest/download/context-lens.apk"
  fi
  mkdir -p "$TOOLS_DIR"
  apk="$TOOLS_DIR/context-lens.apk"
  say "downloading $url"
  "$CURL" -fsSL -o "$apk" "$url" || fail "download failed: $url (no release published yet?)"
fi
[[ -s "$apk" ]] || fail "APK not found or empty: $apk"

say "waiting for a phone with USB debugging on (accept the prompt on the phone)"
serial=""
for _ in $(seq 1 "$WAIT_SECONDS"); do
  # a read loop, not mapfile: macOS ships bash 3.2
  ready=()
  while IFS= read -r line; do ready+=("$line"); done < <("$adb" devices | awk 'NR > 1 && $2 == "device" { print $1 }')
  if [[ ${#ready[@]} -gt 1 && -z "${ANDROID_SERIAL:-}" ]]; then
    fail "more than one device connected; set ANDROID_SERIAL to one of: ${ready[*]}"
  fi
  if [[ -n "${ANDROID_SERIAL:-}" ]]; then
    for s in "${ready[@]}"; do [[ "$s" == "$ANDROID_SERIAL" ]] && serial="$s"; done
  elif [[ ${#ready[@]} -eq 1 ]]; then
    serial="${ready[0]}"
  fi
  [[ -n "$serial" ]] && break
  sleep 1
done
[[ -n "$serial" ]] || fail "no phone found; check the cable, USB debugging and the prompt on the phone"

say "installing on $serial"
"$adb" -s "$serial" install -r "$apk" >/dev/null || fail "install failed (an older copy signed with another key? uninstall it first)"
"$adb" -s "$serial" shell am start -n "$PACKAGE/.MainActivity" >/dev/null || fail "installed, but the app did not start"
say "installed and opened ContextLens on $serial"

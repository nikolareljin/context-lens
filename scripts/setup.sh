#!/usr/bin/env bash
# Check or prepare the local toolchain.
#
# Usage: scripts/setup.sh [--check]
#   --check   report only (default prints the same report and the next steps)
#
# Checks: git, bash 4+, JDK 17+, Android SDK with platform 35+, adb, Node 22+,
# gitleaks, foxguard, exiftool, shellcheck. Nothing is installed without asking.
set -euo pipefail
TL_TAG=setup
# shellcheck source=lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
# shellcheck source=lib/android.sh
source "$TL_ROOT/scripts/lib/android.sh"
load_env

missing=0
ok()   { printf '  ok       %s\n' "$*"; }
miss() { printf '  missing  %s\n' "$*"; missing=$((missing + 1)); }

# report <ok?> <label when ok> <label when missing>
report() { if [[ "$1" == yes ]]; then ok "$2"; else miss "$3"; fi; }
has() { if command -v "$1" >/dev/null 2>&1; then echo yes; else echo no; fi; }
at_least() { if [[ "${1%%.*}" =~ ^[0-9]+$ && "${1%%.*}" -ge "$2" ]]; then echo yes; else echo no; fi; }

echo "toolchain:"
report "$(has git)" "git" "git"
report "$(at_least "${BASH_VERSINFO[0]}" 4)" "bash $BASH_VERSION" "bash 4+ (found $BASH_VERSION)"
jv=""
if command -v java >/dev/null 2>&1; then jv="$(java -version 2>&1 | awk -F'"' '/version/ {print $2; exit}')"; fi
report "$(at_least "${jv:-0}" 17)" "java $jv" "JDK 17+ (found ${jv:-none})"
home="$(android_home)"
sdk=no
for d in "$home"/platforms/android-*; do
  [[ "$(basename "$d")" =~ ^android-([0-9]+) ]] && [[ "${BASH_REMATCH[1]}" -ge 35 ]] && sdk=yes
done
report "$sdk" "Android SDK $home" "Android SDK with platform 35+ (ANDROID_HOME=$home)"
report "$(has "$(adb_bin)")" "adb" "adb (platform-tools)"
nv=""
if command -v node >/dev/null 2>&1; then nv="$(node --version | tr -d v)"; fi
report "$(at_least "${nv:-0}" 22)" "node $nv" "node 22+ (found ${nv:-none}; see .nvmrc)"
report "$(has gitleaks)" "gitleaks" "gitleaks (secret scan)"
report "$(has foxguard)" "foxguard" "foxguard (security scan, github.com/0sec-labs/foxguard)"
report "$(has exiftool)" "exiftool" "exiftool (image metadata check)"
report "$(has shellcheck)" "shellcheck" "shellcheck (script lint)"
[[ -f "$TL_ANDROID_DIR/app/google-services.json" ]] && ok "google-services.json" \
  || printf '  later    google-services.json (from the Firebase console, see README)\n'

if [[ "$missing" -gt 0 ]]; then
  echo "$missing item(s) missing"
  exit 1
fi
echo "all present"

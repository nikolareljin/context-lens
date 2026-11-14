#!/usr/bin/env bash
# Deploy Firebase resources and distribute the app to testers.
#
# Usage: scripts/deploy.sh <target> [--dry-run]
#   rules       Firestore rules and indexes
#   functions   Cloud Functions
#   hosting     web dashboard
#   apk <file>  upload an APK to Firebase App Distribution
#   all         rules, functions and hosting that exist in the repository
#
# Needs FIREBASE_PROJECT_ID (from .env or the environment) and credentials:
# local `firebase login`, or Application Default Credentials in CI.
# Stand-in for tests: FIREBASE (default: npx firebase-tools at a pinned version).
set -euo pipefail
TL_TAG=deploy
# shellcheck source=lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
load_env
cd "$TL_ROOT"

FIREBASE_TOOLS_VERSION="15.34.2"
target="${1:-}"; shift || true
dry=0; args=()
for a in "$@"; do [[ "$a" == "--dry-run" ]] && dry=1 || args+=("$a"); done

firebase() {
  if [[ "$dry" -eq 1 ]]; then echo "would run: firebase $*"; return 0; fi
  if [[ -n "${FIREBASE:-}" ]]; then "$FIREBASE" "$@"
  else need npx "Node 22, see .nvmrc"; npx --yes "firebase-tools@$FIREBASE_TOOLS_VERSION" "$@"; fi
}

project() {
  [[ -n "${FIREBASE_PROJECT_ID:-}" ]] || die "FIREBASE_PROJECT_ID is not set"
  printf '%s' "$FIREBASE_PROJECT_ID"
}

only_present() {
  local parts=()
  [[ -f firebase/firestore.rules ]] && parts+=("firestore")
  [[ -d functions ]] && parts+=("functions")
  [[ -d apps/web ]] && parts+=("hosting")
  local IFS=,; printf '%s' "${parts[*]}"
}

proj=""
case "$target" in
  rules|functions|hosting|all|apk) proj="$(project)" ;;
esac

case "$target" in
  rules)     [[ -f firebase.json ]] || die "firebase.json is not present yet"
             firebase deploy --non-interactive --project "$proj" --only firestore ;;
  functions) [[ -d functions ]] || die "functions/ is not present yet"
             firebase deploy --non-interactive --project "$proj" --only functions ;;
  hosting)   [[ -d apps/web ]] || die "apps/web is not present yet"
             firebase deploy --non-interactive --project "$proj" --only hosting ;;
  all)
    [[ -f firebase.json ]] || die "firebase.json is not present yet"
    only="$(only_present)"
    [[ -n "$only" ]] || die "nothing to deploy"
    firebase deploy --non-interactive --project "$proj" --only "$only" ;;
  apk)
    file="${args[0]:-}"
    [[ -n "$file" && -f "$file" ]] || die "usage: deploy.sh apk <file.apk>"
    [[ -n "${FIREBASE_ANDROID_APP_ID:-}" ]] || die "FIREBASE_ANDROID_APP_ID is not set"
    notes="$(version) $(git rev-parse --short HEAD 2>/dev/null || true)"
    firebase appdistribution:distribute "$file" --project "$proj" \
      --app "$FIREBASE_ANDROID_APP_ID" --groups "${TESTER_GROUPS:-testers}" --release-notes "$notes" ;;
  ""|-h|--help) usage_from "${BASH_SOURCE[0]}" ;;
  *) die "unknown target: $target (try --help)" ;;
esac

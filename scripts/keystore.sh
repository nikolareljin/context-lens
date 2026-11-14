#!/usr/bin/env bash
# Create the release signing keystore outside the repository.
#
# Usage: scripts/keystore.sh [path]
#   default path: ~/.config/context-lens/release.jks
# Prompts for the passwords (keytool). Prints the SHA-256 fingerprint to add
# to the Firebase Android app. Refuses to write inside the repository.
set -euo pipefail
TL_TAG=keystore
# shellcheck source=lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
need keytool "part of the JDK"

path="${1:-$HOME/.config/context-lens/release.jks}"
mkdir -p "$(dirname "$path")"
abs="$(cd "$(dirname "$path")" && pwd)/$(basename "$path")"
[[ "$abs" != "$TL_ROOT"/* ]] || die "the keystore must live outside the repository"
[[ ! -e "$abs" ]] || die "$abs exists already"
alias_name="${ANDROID_KEY_ALIAS:-contextlens}"
keytool -genkeypair -v -keystore "$abs" -alias "$alias_name" -keyalg RSA -keysize 4096 -validity 10000 \
  -dname "CN=ContextLens"
chmod 600 "$abs"
keytool -list -v -keystore "$abs" -alias "$alias_name" | grep -E 'SHA256:' || true
log "set ANDROID_KEYSTORE_PATH=$abs and ANDROID_KEY_ALIAS=$alias_name in .env"

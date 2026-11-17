#!/usr/bin/env bash
# Write apps/android/app/google-services.json for a build.
#
# Usage: scripts/firebase-config.sh [--placeholder]
#   GOOGLE_SERVICES_JSON_B64 set   decode it (CI with access to secrets)
#   --placeholder or no secret     copy scripts/ci/google-services.placeholder.json,
#                                  which builds but cannot reach any Firebase project
# An existing file is kept unless FORCE=1. --placeholder always replaces it, so a public
# build can never pick up a real project left on the machine.
set -euo pipefail
TL_TAG=firebase-config
# shellcheck source=lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

target="${TL_ANDROID_DIR:-$TL_ROOT/apps/android}/app/google-services.json"
placeholder="$TL_ROOT/scripts/ci/google-services.placeholder.json"

if [[ -f "$target" && "${FORCE:-0}" != 1 && "${1:-}" != "--placeholder" ]]; then
  log "keeping existing $(basename "$target")"; exit 0
fi
mkdir -p "$(dirname "$target")"
if [[ "${1:-}" != "--placeholder" && -n "${GOOGLE_SERVICES_JSON_B64:-}" ]]; then
  printf '%s' "$GOOGLE_SERVICES_JSON_B64" | base64 -d > "$target"
  grep -q '"project_info"' "$target" || { rm -f "$target"; die "decoded secret is not a google-services.json"; }
  log "wrote Firebase configuration from the secret"
else
  [[ -f "$placeholder" ]] || die "placeholder missing: $placeholder"
  cp "$placeholder" "$target"
  log "wrote placeholder Firebase configuration (no project access)"
fi

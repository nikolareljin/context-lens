#!/usr/bin/env bash
# Package the Chrome extension build for a release.
#
# Usage: scripts/extension-package.sh
# Reads apps/web/dist-extension (./dev web extension builds it), writes into dist/.
# Checks: manifest.json carries the repository's VERSION and asks for no more than the side
# panel and no custom content security policy; no Firebase key, app id, project host or site key
# (site-leak-check.sh); no App Check or Auth popup code; no remote script in a page. Writes context-lens-extension.zip (manifest.json at its
# root) and context-lens-extension.zip.sha256 ("<sha256>  context-lens-extension.zip").
set -euo pipefail
TL_TAG=extension
# shellcheck source=lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

[[ $# -eq 0 ]] || die "takes no arguments (it reads apps/web/dist-extension and writes dist/)" 2
build="$TL_ROOT/apps/web/dist-extension"
out="$TL_ROOT/dist"
[[ -f "$build/manifest.json" ]] || die "no extension build in $build (run ./dev web extension)"
command -v jq >/dev/null || die "jq is needed"
command -v zip >/dev/null || die "zip is needed"

v="$(version)"
[[ "$(jq -r '.version // ""' "$build/manifest.json")" == "$v" ]] || die "manifest.json version differs from VERSION ($v)"
[[ "$(jq -c '.permissions // []' "$build/manifest.json")" == '["sidePanel"]' ]] || die "manifest.json asks for more than the side panel"
[[ "$(jq -c '[.host_permissions, .optional_permissions, .optional_host_permissions, .content_scripts, .externally_connectable, .content_security_policy] | map(select(. != null))' "$build/manifest.json")" == '[]' ]] \
  || die "manifest.json asks for host access, content scripts or a custom content security policy"

bash "$TL_ROOT/scripts/site-leak-check.sh" "$build"

# Extension pages run only scripts from the package (Manifest V3's fixed policy, kept by refusing a
# custom one above). The code that would try to load Google scripts is left out of the build:
# App Check's reCAPTCHA provider (its token exchange) and Firebase Auth's popup/redirect loader.
if grep -RIlE 'exchangeRecaptchaEnterpriseToken|gapi\.iframes' "$build" >/dev/null; then
  die "the extension build carries App Check or the Auth popup loader (they load scripts from Google)"
fi
if grep -RIlE '<script[^>]+src="(https?:)?//' "$build" --include='*.html' >/dev/null; then
  die "an extension page references a remote script"
fi

mkdir -p "$out"
zip_path="$out/context-lens-extension.zip"
rm -f "$zip_path" "$zip_path.sha256"
(cd "$build" && zip -q -X -r "$zip_path" .)
(cd "$out" && sha256sum context-lens-extension.zip > context-lens-extension.zip.sha256)
log "packaged $v: $zip_path ($(wc -c < "$zip_path" | tr -d ' ') bytes) and its .sha256"

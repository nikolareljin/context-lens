#!/usr/bin/env bash
# Install or update the ContextLens Chrome extension (Linux, macOS, WSL).
#
#   curl -fsSL https://raw.githubusercontent.com/nikolareljin/context-lens/main/scripts/extension-install.sh | bash
#
# 1. Downloads context-lens-extension.zip from the newest release, checks it against its
#    .sha256 and unpacks it into ~/context-lens/extension (running it again updates it).
# 2. With Chromium or Chrome for Testing installed, starts it with the extension loaded, in its
#    own profile (~/context-lens/browser-profile). Nothing else to do.
# 3. Otherwise (Google Chrome no longer loads extensions from the command line), copies the
#    folder path, opens chrome://extensions and prints the four clicks that load it.
#
# Usage: extension-install.sh [--version X.Y.Z] [--no-launch]
#   (piped: curl ... | bash -s -- --no-launch)
# Environment, mainly for tests: CONTEXTLENS_RELEASE_URL (base address of the release files),
# CONTEXTLENS_BROWSER / CONTEXTLENS_CHROME (a browser path, or "none"), CONTEXTLENS_COPY
# (clipboard command, or "none"), CONTEXTLENS_WSL (1 or 0 instead of detecting WSL).
# Standalone on purpose: it runs from a pipe, without the rest of the repository. Everything is
# inside main(), which runs only once the whole script has arrived.
set -euo pipefail

EXTENSION_ID="ibebpiolnohegpeabdgikjjnolphpbcd"
RELEASES="https://github.com/nikolareljin/context-lens/releases"
HELP="https://nikolareljin.github.io/context-lens/docs/extension/"

main() {
  say() { printf '%s\n' "$*"; }
  step() { printf '\n\033[1m%s\033[0m\n' "$*"; }
  die() { printf 'context-lens: %s\n' "$*" >&2; exit 1; }

  # A fixed folder: the only one this script ever replaces.
  version="" dir="${HOME:?}/context-lens/extension" launch=1
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --version) version="${2:?--version needs X.Y.Z}"; shift 2 ;;
      --no-launch) launch=0; shift ;;
      -h|--help)
        if [[ -f "${BASH_SOURCE[0]:-}" ]]; then sed -n '2,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; else say "See $HELP"; fi
        exit 0 ;;
      *) die "unknown option: $1 (try --help)" ;;
    esac
  done
  if [[ -n "$version" && ! "$version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]; then
    die "--version must look like 0.3.0"
  fi
  if [[ -n "$version" ]]; then base="$RELEASES/download/$version"; else base="$RELEASES/latest/download"; fi
  base="${CONTEXTLENS_RELEASE_URL:-$base}"

  if [[ "${CONTEXTLENS_WSL:-}" == 1 ]] || { [[ -z "${CONTEXTLENS_WSL:-}" ]] && grep -qi microsoft /proc/version 2>/dev/null; }; then
    step "WSL: the extension is for Chrome on Windows"
    say "Run this in Windows PowerShell instead, so Chrome can read the folder:"
    say "  irm https://raw.githubusercontent.com/nikolareljin/context-lens/main/scripts/extension-install.ps1 | iex"
    exit 0
  fi

  for tool in curl unzip; do command -v "$tool" >/dev/null || die "$tool is needed (install it and run this again)"; done
  # fetch zip|sum: downloads one of the two release files into $tmp. A missing file means that
  # release has no extension (it came with 0.3.0).
  fetch() {
    local url out code
    case "$1" in
      zip) url="$base/context-lens-extension.zip"; out="$tmp/ext.zip" ;;
      sum) url="$base/context-lens-extension.zip.sha256"; out="$tmp/ext.zip.sha256" ;;
      *) die "fetch: zip or sum" ;;
    esac
    code="$(curl -sSL --retry 2 -o "$out" -w '%{http_code}' "$url")" || die "download failed: $url"
    case "$code" in
      200|000) ;;
      404) die "${version:-the newest release} has no Chrome extension yet; see $HELP" ;;
      *) die "download failed (HTTP $code): $url" ;;
    esac
  }
  sha256() {
    if command -v sha256sum >/dev/null; then sha256sum "$1" | awk '{ print $1 }'
    elif command -v shasum >/dev/null; then shasum -a 256 "$1" | awk '{ print $1 }'
    else die "sha256sum or shasum is needed"; fi
  }

  # ---- download, check, unpack ---------------------------------------------------------------
  # The download waits next to the install folder (same disk for the final move) and is removed.
  mkdir -p "$(dirname "$dir")"
  tmp="$(mktemp -d "$(dirname "$dir")/.download.XXXXXX")"
  trap 'rm -rf -- "$tmp"' EXIT
  step "Downloading the ContextLens extension${version:+ $version}"
  fetch zip
  fetch sum
  expected="$(awk 'NR == 1 { print $1 }' "$tmp/ext.zip.sha256")"
  [[ "$expected" =~ ^[0-9a-f]{64}$ ]] || die "the checksum file is not valid"
  [[ "$(sha256 "$tmp/ext.zip")" == "$expected" ]] || die "checksum mismatch: the download is damaged or not the released file"
  say "checksum ok"
  mkdir -p "$tmp/unpacked"
  unzip -q "$tmp/ext.zip" -d "$tmp/unpacked" || die "the download is not a valid zip"
  grep -q '"name": *"ContextLens"' "$tmp/unpacked/manifest.json" 2>/dev/null || die "the download is not the ContextLens extension"
  got="$(sed -nE 's/.*"version": *"([0-9.]+)".*/\1/p' "$tmp/unpacked/manifest.json" | head -n 1)"

  # Only a folder that holds an earlier copy of this extension (or nothing) is replaced.
  if [[ -e "$dir" ]]; then
    if [[ -n "$(ls -A "$dir" 2>/dev/null)" ]] && ! grep -q '"name": *"ContextLens"' "$dir/manifest.json" 2>/dev/null; then
      die "$dir exists and is not a ContextLens extension folder; move it away and run this again"
    fi
    rm -rf -- "$dir"
  fi
  mv "$tmp/unpacked" "$dir"
  dir="$(cd "$dir" && pwd)"
  say "ContextLens $got is in $dir"

  # ---- load it --------------------------------------------------------------------------------
  find_first() { local p; for p in "$@"; do if [[ -x "$p" ]]; then printf '%s\n' "$p"; return 0; fi; done; return 1; }
  find_loader() {
    if [[ -n "${CONTEXTLENS_BROWSER:-}" ]]; then [[ "$CONTEXTLENS_BROWSER" == none ]] && return 1; printf '%s\n' "$CONTEXTLENS_BROWSER"; return 0; fi
    local p
    for p in chromium chromium-browser; do if command -v "$p" >/dev/null; then command -v "$p"; return 0; fi; done
    local cft=()
    shopt -s nullglob
    cft+=("$HOME"/.cache/puppeteer/chrome/*/chrome-linux64/chrome)
    cft+=("$HOME"/.cache/puppeteer/chrome/*/chrome-mac-*/Google\ Chrome\ for\ Testing.app/Contents/MacOS/Google\ Chrome\ for\ Testing)
    shopt -u nullglob
    find_first "/Applications/Chromium.app/Contents/MacOS/Chromium" \
      "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" ${cft[@]+"${cft[@]}"}
  }
  find_chrome() {
    if [[ -n "${CONTEXTLENS_CHROME:-}" ]]; then [[ "$CONTEXTLENS_CHROME" == none ]] && return 1; printf '%s\n' "$CONTEXTLENS_CHROME"; return 0; fi
    local p
    for p in google-chrome google-chrome-stable microsoft-edge brave-browser; do if command -v "$p" >/dev/null; then command -v "$p"; return 0; fi; done
    find_first "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
  }
  copy_path() {
    local cmd="${CONTEXTLENS_COPY:-}"
    if [[ "$cmd" == none ]]; then return 1; fi
    if [[ -n "$cmd" ]]; then printf '%s' "$dir" | "$cmd"; return; fi
    if command -v pbcopy >/dev/null; then printf '%s' "$dir" | pbcopy
    elif [[ -n "${WAYLAND_DISPLAY:-}" ]] && command -v wl-copy >/dev/null; then printf '%s' "$dir" | wl-copy
    elif command -v xclip >/dev/null; then printf '%s' "$dir" | xclip -selection clipboard
    elif command -v xsel >/dev/null; then printf '%s' "$dir" | xsel --clipboard --input
    else return 1; fi
  }
  start() { nohup "$@" </dev/null >/dev/null 2>&1 & disown || true; }

  if loader="$(find_loader)"; then
    profile="$(dirname "$dir")/browser-profile"
    if [[ "$launch" -eq 1 ]]; then
      step "Starting $(basename "$loader") with ContextLens loaded"
      start "$loader" --user-data-dir="$profile" --load-extension="$dir" --no-first-run \
        "chrome-extension://$EXTENSION_ID/sidepanel.html"
    else
      step "Start it with ContextLens loaded:"
    fi
    say "  \"$loader\" --user-data-dir=\"$profile\" --load-extension=\"$dir\""
    say "It uses its own profile, so your usual browser profile is left alone. The ContextLens page"
    say "opens in a tab; for the side panel, click the puzzle icon, pin ContextLens and click its icon."
    say "To update later, run the same install command again and restart that browser."
  else
    chrome="$(find_chrome || true)"
    copied=0; if copy_path; then copied=1; fi
    if [[ "$launch" -eq 1 && -n "$chrome" ]]; then
      if [[ "$(uname -s)" == Darwin ]]; then start open -a "$(basename "$chrome")" "chrome://extensions"
      else start "$chrome" "chrome://extensions"; fi
      step "Chrome is opening chrome://extensions. Load ContextLens there:"
    else
      step "Open chrome://extensions in Chrome (type it in the address bar), then:"
    fi
    say "  1. Turn on \"Developer mode\" (the switch in the top-right corner)."
    say "  2. Click \"Load unpacked\" (top left)."
    if [[ "$copied" -eq 1 ]]; then
      say "  3. Choose this folder (the path is already copied: paste it with Ctrl+L then Ctrl+V,"
      say "     or Cmd+Shift+G then Cmd+V on a Mac) and click \"Select\":"
    else
      say "  3. Choose this folder and click \"Select\":"
    fi
    say "       $dir"
    say "  4. Click the puzzle icon next to the address bar, pin ContextLens, and click its icon"
    say "     to open the side panel."
    say "To update later: run the same install command again, then click the reload arrow on the"
    say "ContextLens card in chrome://extensions."
  fi
  say ""
  say "Step-by-step guide: $HELP"
}

main "$@"

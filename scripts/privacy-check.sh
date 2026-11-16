#!/usr/bin/env bash
# Personal-data check for everything this public repository publishes: the
# tree, and with --range every commit (message, author, committer) and every
# file version in it.
#
# Usage: scripts/privacy-check.sh [--range <base>..<head>]
#
# Fails on:
#   - an email address outside the reserved example domains and GitHub noreply
#   - a North American phone number whose exchange is not the fictional 555
#   - a real Firebase app ID, project number, web API key or project hostname
#   - a latitude/longitude pair written to four or more decimals
#   - an image or PDF with GPS, camera, author or owner metadata (needs exiftool)
# Exit 0 only when everything is clean.
set -euo pipefail
TL_TAG=privacy
# shellcheck source=lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"

range=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --range) range="${2:?--range needs <base>..<head>}"; shift 2 ;;
    -h|--help) sed -n '2,14p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
done

repo="$(git rev-parse --show-toplevel)"
cd "$repo"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
hits=0

hit() { echo "  $1" >&2; hits=$((hits + 1)); }

email_re='[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}'
# reserved for documentation (RFC 2606, RFC 6761) and GitHub's noreply addresses
email_ok='@((([A-Za-z0-9-]+\.)*example\.(com|org|net|edu))|([A-Za-z0-9.-]+\.(example|invalid|test|localhost))|users\.noreply\.github\.com|noreply\.github\.com)$'
phone_re='(^|[^0-9A-Za-z])(\+?1[ .-]?)?\(?[2-9][0-9]{2}\)?[ .-]?[2-9][0-9]{2}[ .-]?[0-9]{4}([^0-9A-Za-z]|$)'
phone_ok='\(?[2-9][0-9]{2}\)?[ .-]?555[ .-]?[0-9]{4}'
firebase_re='[0-9]+:[0-9]{6,}:(android|ios|web):[0-9a-f]+|"project_number": *"[0-9]*[1-9][0-9]*"|AIza[0-9A-Za-z_-]{35}|[a-z0-9-]+\.(firebaseapp\.com|appspot\.com|firebasestorage\.app|web\.app)'
# made-up values the tests use: all-zero or 555 project numbers, "demo-" projects (the
# Firebase convention for projects that do not exist)
firebase_ok=':(0+|555[0-9]*):|"project_number": *"(0+|555[0-9]*)"|(^|[^a-z0-9-])demo-[a-z0-9-]*\.'
coord_re='-?[0-9]{1,3}\.[0-9]{4,}[ ]*,[ ]*-?[0-9]{1,3}\.[0-9]{4,}'

# scan_text_file <file> <label>
scan_text_file() {
  local f="$1" label="$2" line
  grep -Iq . "$f" 2>/dev/null || return 0
  while IFS= read -r line; do
    hit "$label:${line%%:*}: email address outside the example domains"
  done < <(grep -noE -- "$email_re" "$f" | grep -viE -- "$email_ok" || true)
  while IFS= read -r line; do
    hit "$label:${line%%:*}: phone number outside 555"
  done < <(grep -noE -- "$phone_re" "$f" | grep -vE -- "$phone_ok" || true)
  while IFS= read -r line; do
    hit "$label:${line%%:*}: Firebase identifier, key or project host"
  done < <(grep -noE -- "$firebase_re" "$f" | grep -vE -- "$firebase_ok" || true)
  while IFS= read -r line; do
    hit "$label:${line%%:*}: coordinates"
  done < <(grep -noE -- "$coord_re" "$f" || true)
}

scan_image_file() {
  local f="$1" label="$2"
  case "$(printf '%s' "$label" | tr '[:upper:]' '[:lower:]')" in
    *.jpg|*.jpeg|*.png|*.webp|*.heic|*.tif|*.tiff|*.gif|*.pdf) ;;
    *) return 0 ;;
  esac
  command -v exiftool >/dev/null 2>&1 || { hit "$label: exiftool is not installed, image metadata not checked"; return 0; }
  if exiftool -q -q -GPS:all -Make -Model -SerialNumber -OwnerName -Artist -Author -Creator -- "$f" | grep -q .; then
    hit "$label: file carries GPS, camera, author or owner metadata"
  fi
}

scan_path() { scan_text_file "$1" "$2"; scan_image_file "$1" "$2"; }

# the tree: tracked files plus new files not ignored
while IFS= read -r -d '' path; do
  [[ -f "$path" ]] && scan_path "$path" "$path"
done < <(git ls-files -z --cached --others --exclude-standard)

# the range: every commit message and every file version it adds
if [[ -n "$range" ]]; then
  git rev-list "$range" >/dev/null || die "cannot list the commits in $range"
  while IFS= read -r commit; do
    [[ -n "$commit" ]] || continue
    git log -1 --format=%B "$commit" > "$tmp/msg"
    scan_text_file "$tmp/msg" "commit ${commit:0:12} message"
    # the author and committer published with the commit
    git log -1 --format='%an <%ae>%n%cn <%ce>' "$commit" > "$tmp/who"
    scan_text_file "$tmp/who" "commit ${commit:0:12} author/committer"
    while IFS= read -r -d '' path; do
      # one fixed file for every blob: the label carries the path (and the image extension)
      git show "$commit:$path" > "$tmp/blob" 2>/dev/null || continue
      scan_path "$tmp/blob" "${commit:0:12}:$path"
    # -m: a merge lists what it changed against each parent, so a merge resolution is seen too
    done < <(git diff-tree -m --root --no-commit-id --name-only --diff-filter=ACMR -r -z "$commit" | sort -zu)
  done < <(git rev-list "$range")
fi

if [[ "$hits" -gt 0 ]]; then
  die "$hits finding(s): remove the data above (and rewrite the commit that added it)"
fi
log "clean"

#!/usr/bin/env bash
# Build or serve the documentation site (MkDocs Material, docs/requirements.txt).
#
# Usage: scripts/docs.sh <build|serve>
#   build   strict build into site/ (what the Pages workflow publishes)
#   serve   live preview on http://127.0.0.1:${DOCS_PORT:-8008} (this machine only)
#
# Runs mkdocs from a local virtualenv (.venv-docs, git-ignored) when Python 3
# can create one, else from Docker (squidfunk/mkdocs-material at the pinned
# version). Stand-in for tests: MKDOCS (a command to run instead of mkdocs).
set -euo pipefail
TL_TAG=docs
# shellcheck source=lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
cd "$TL_ROOT"

req="docs/requirements.txt"
pinned="$(sed -n 's/^mkdocs-material==//p' "$req")"
[[ -n "$pinned" ]] || die "$req must pin mkdocs-material==X.Y.Z"
port="${DOCS_PORT:-8008}"
[[ "$port" =~ ^[0-9]+$ ]] || die "DOCS_PORT must be a number"

# venv_ready: create or refresh .venv-docs; fails when Python cannot make one
# (on Debian and Ubuntu the venv module needs the python3-venv package).
venv_ready() {
  command -v python3 >/dev/null 2>&1 || return 1
  if [[ -x .venv-docs/bin/mkdocs ]] && cmp -s "$req" .venv-docs/requirements.txt; then return 0; fi
  log "preparing .venv-docs"
  rm -rf .venv-docs
  python3 -m venv .venv-docs >/dev/null 2>&1 || { rm -rf .venv-docs; return 1; }
  .venv-docs/bin/pip install -q -r "$req" || { rm -rf .venv-docs; die "pip could not install $req"; }
  cp "$req" .venv-docs/requirements.txt
}

# mkdocs_cmd <serve|other> <args...>
mkdocs_cmd() {
  local mode="$1"; shift
  local local_addr=()
  [[ "$mode" == serve ]] && local_addr=(--dev-addr "127.0.0.1:$port")
  if [[ -n "${MKDOCS:-}" ]]; then "$MKDOCS" "$@" "${local_addr[@]}"; return; fi
  if venv_ready; then
    .venv-docs/bin/mkdocs "$@" "${local_addr[@]}"
  elif command -v docker >/dev/null 2>&1; then
    local publish=()
    # inside the container the server must listen on all interfaces; the host side stays local
    [[ "$mode" == serve ]] && publish=(-p "127.0.0.1:$port:$port")
    local extra=()
    [[ "$mode" == serve ]] && extra=(--dev-addr "0.0.0.0:$port")
    docker run --rm -u "$(id -u):$(id -g)" "${publish[@]}" -v "$TL_ROOT:/docs" \
      "squidfunk/mkdocs-material:$pinned" "$@" "${extra[@]}"
  else
    die "needs python3 with venv (python3-venv) or docker"
  fi
}

case "${1:-}" in
  build) mkdocs_cmd build build --strict --site-dir site ;;
  serve) mkdocs_cmd serve serve ;;
  ""|-h|--help) usage_from "${BASH_SOURCE[0]}" ;;
  *) die "unknown command: $1 (build or serve)" ;;
esac

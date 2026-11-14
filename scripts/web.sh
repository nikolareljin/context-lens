#!/usr/bin/env bash
# Web companion tasks (apps/web).
#
# Usage: scripts/web.sh <command>
#   install   npm ci
#   lint      type check
#   test      unit tests (vitest)
#   build     production build into apps/web/dist
#   dev       local server on 127.0.0.1 (http://127.0.0.1:5173/context-lens/)
#   check     install, lint, test, build (what CI runs)
#
# Uses the local npm when Node is 20 or newer, otherwise the node:22 container (Docker).
# Environment: NPM (a stand-in for tests), WEB_NODE_IMAGE (default node:22).
set -euo pipefail
TL_TAG=web
# shellcheck source=lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
web_dir="$TL_ROOT/apps/web"
[[ -f "$web_dir/package.json" ]] || die "apps/web is not present"

node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  local major; major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  [[ "$major" -ge 20 ]]
}

run_npm() {
  if [[ -n "${NPM:-}" ]]; then (cd "$web_dir" && "$NPM" "$@"); return; fi
  if node_ok; then (cd "$web_dir" && npm "$@"); return; fi
  need docker "https://docs.docker.com/engine/install/"
  local publish=() args=("$@")
  if [[ "${1:-}" == run && "${2:-}" == dev ]]; then
    # inside the container the server must listen on all its interfaces; the host publishes
    # the port on 127.0.0.1 only, so the preview stays local
    publish=(-p 127.0.0.1:5173:5173)
    args=(run dev -- --host 0.0.0.0)
  fi
  docker run --rm --init -u "$(id -u):$(id -g)" -e HOME=/tmp ${publish[@]+"${publish[@]}"} \
    -v "$TL_ROOT":/w -w /w/apps/web "${WEB_NODE_IMAGE:-node:22}" npm "${args[@]}"
}

cmd="${1:-}"; shift || true
case "$cmd" in
  install) run_npm ci --no-audit --no-fund ;;
  lint) run_npm run lint ;;
  test) run_npm test ;;
  build) run_npm run build ;;
  dev) run_npm run dev -- --host 127.0.0.1 ;;
  check) run_npm ci --no-audit --no-fund && run_npm run lint && run_npm test && run_npm run build ;;
  ""|-h|--help) usage_from "${BASH_SOURCE[0]}" ;;
  *) die "unknown command: $cmd (try --help)" ;;
esac

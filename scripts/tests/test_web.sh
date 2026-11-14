#!/usr/bin/env bash
# shellcheck disable=SC2329,SC2016  # test functions are found by name
source "$(dirname "${BASH_SOURCE[0]}")/assert.sh"
script="$TL_ROOT/scripts/web.sh"

fake_npm() {
  printf '#!/usr/bin/env bash\necho "npm $*" >> "%s/npm-calls"\n' "$PWD" > npm
  chmod +x npm; export NPM="$PWD/npm"
}

test_check_runs_what_ci_runs_in_order() {
  fake_npm
  bash "$script" check >/dev/null 2>&1 || fail "check failed"
  assert_eq "$(tr '\n' '|' < npm-calls)" "npm ci --no-audit --no-fund|npm run lint|npm test|npm run build|"
}
test_dev_binds_localhost_only() {
  fake_npm
  bash "$script" dev >/dev/null 2>&1 || fail "dev failed"
  assert_contains "$(cat npm-calls)" "run dev -- --host 127.0.0.1"
}
test_unknown_command_fails() {
  fake_npm
  assert_status 1 bash "$script" nope
}
test_base_path_matches_pages() {
  assert_contains "$(cat "$TL_ROOT/apps/web/vite.config.ts")" 'base: "/context-lens/"'
  assert_contains "$(cat "$TL_ROOT/mkdocs.yml")" "site_url: https://nikolareljin.github.io/context-lens/docs/"
}
test_ownership_file_is_served_from_the_root() {
  [[ -f "$TL_ROOT/apps/web/public/googlefb1695ee9a07673e.html" ]] || fail "ownership file missing from apps/web/public"
  assert_eq "$(cat "$TL_ROOT/apps/web/public/googlefb1695ee9a07673e.html")" "google-site-verification: googlefb1695ee9a07673e.html"
}
run_tests

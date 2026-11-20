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
test_extension_builds_the_extension_then_packages_it() {
  fake_npm
  printf '#!/usr/bin/env bash\necho packaged >> %s/npm-calls\n' "$PWD" > packager
  EXTENSION_PACKAGER="$PWD/packager" bash "$script" extension >/dev/null 2>&1 || fail "extension failed"
  assert_eq "$(tr '\n' '|' < npm-calls)" "npm run build:extension|packaged|"
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
  assert_contains "$(cat "$TL_ROOT/apps/web/vite.config.ts")" 'base: mode === "extension" ? "./" : "/context-lens/"'
  assert_contains "$(cat "$TL_ROOT/mkdocs.yml")" "site_url: https://nikolareljin.github.io/context-lens/docs/"
}
test_link_previews_use_the_social_card() {
  local html; html="$(cat "$TL_ROOT/apps/web/index.html")"
  assert_contains "$html" 'property="og:image" content="https://nikolareljin.github.io/context-lens/docs/assets/social-card.png"'
  assert_contains "$html" 'name="twitter:card" content="summary_large_image"'
  [[ -f "$TL_ROOT/docs/assets/social-card.png" ]] || fail "docs/assets/social-card.png is missing"
  assert_contains "$(cat "$TL_ROOT/docs-overrides/main.html")" 'og:image'
}
test_ownership_file_is_served_from_the_root() {
  [[ -f "$TL_ROOT/apps/web/public/googlefb1695ee9a07673e.html" ]] || fail "ownership file missing from apps/web/public"
  assert_eq "$(cat "$TL_ROOT/apps/web/public/googlefb1695ee9a07673e.html")" "google-site-verification: googlefb1695ee9a07673e.html"
}
run_tests

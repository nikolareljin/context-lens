#!/usr/bin/env bash
# shellcheck disable=SC2329  # test functions are found by name
source "$(dirname "${BASH_SOURCE[0]}")/assert.sh"
script="$TL_ROOT/scripts/site-leak-check.sh"

# Values are assembled at run time so this file itself passes the leak checks.
key="AI""za$(printf 'Q%.0s' {1..35})"
app_id="1:48""1234567:web:ab12cd"
host="springfield-app.firebase""app.com"
pages_host="springfield-app.we""b.app"

site() { mkdir -p site/assets; echo '<!doctype html><title>ContextLens</title>' > site/index.html; }
check() { "$script" "$@" 2>&1; }

test_a_clean_site_passes() {
  site
  echo 'const a = "on-device-only";' > site/assets/index.js
  assert_status 0 bash "$script" site
}
test_an_api_key_fails_without_printing_it() {
  site; printf 'x={apiKey:"%s"}\n' "$key" > site/assets/index.js
  out="$(check site || true)"
  assert_contains "$out" "site/assets/index.js line 1: Firebase web API key"
  [[ "$out" != *"$key"* ]] || fail "the key was printed"
  assert_status 1 bash "$script" site
}
test_an_app_id_fails() {
  site; printf '\n\nappId:"%s"\n' "$app_id" > site/assets/chunk.js
  out="$(check site || true)"
  assert_contains "$out" "site/assets/chunk.js line 3: Firebase app id"
}
test_project_hosts_fail() {
  site; printf '%s\n%s\n' "$host" "https://$pages_host/x" > site/docs.html
  out="$(check site || true)"
  assert_contains "$out" "site/docs.html line 1: Firebase project host"
  assert_contains "$out" "site/docs.html line 2: Firebase project host"
}
test_only_demo_hosts_are_allowed() {
  site; printf 'authDomain: "demo-springfield.firebaseapp.com"\n' > site/docs.html
  assert_status 0 bash "$script" site
  printf 'x.demo-springfield.%s\n' "firebaseapp.com" > site/docs.html
  assert_status 0 bash "$script" site
  printf 'notdemo-springfield.%s\n' "firebaseapp.com" > site/docs.html
  assert_status 1 bash "$script" site
}
test_a_key_inside_a_binary_file_fails() {
  site; { printf '\x00\x01PNG'; printf '%s' "$key"; printf '\x00'; } > site/assets/image.png
  out="$(check site || true)"
  assert_contains "$out" "site/assets/image.png"
}
test_nested_directories_are_scanned() {
  site; mkdir -p site/docs/deep; printf '%s\n' "$app_id" > site/docs/deep/page.html
  assert_status 1 bash "$script" site
}
test_usage_errors() {
  assert_status 2 bash "$script"
  assert_status 2 bash "$script" missing-dir
}
run_tests

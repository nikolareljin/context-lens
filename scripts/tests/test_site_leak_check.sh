#!/usr/bin/env bash
# shellcheck disable=SC2329  # test functions are found by name
source "$(dirname "${BASH_SOURCE[0]}")/assert.sh"
script="$TL_ROOT/scripts/site-leak-check.sh"

# Values are assembled at run time so this file itself passes the leak checks.
key="AI""za$(printf 'Q%.0s' {1..35})"
app_id="1:48""1234567:web:ab12cd"
host="springfield-app.firebase""app.com"
pages_host="springfield-app.we""b.app"
bucket_host="springfield-app.firebase""storage.app"
appspot_host="springfield-app.app""spot.com"
site_key="6L""$(printf 'q%.0s' {1..38})"

site() { mkdir -p site/assets; echo '<!doctype html><title>ContextLens</title>' > site/index.html; }
check() { "$script" "$@" 2>&1; }

test_a_clean_site_passes() {
  site
  echo 'const a = "on-device-only";' > site/assets/index.js
  assert_status 0 "$script" site
}
test_an_api_key_fails_without_printing_it() {
  site; printf 'x={apiKey:"%s"}\n' "$key" > site/assets/index.js
  out="$(check site || true)"
  assert_contains "$out" "site/assets/index.js line 1: Firebase web API key"
  [[ "$out" != *"$key"* ]] || fail "the key was printed"
  assert_status 1 "$script" site
}
test_an_app_id_fails() {
  site; printf '\n\nappId:"%s"\n' "$app_id" > site/assets/chunk.js
  out="$(check site || true)"
  assert_contains "$out" "site/assets/chunk.js line 3: Firebase app id"
}
test_a_percent_encoded_app_id_fails() {
  site; printf 'contextlens-web-connect:1?project=demo-x&app=%s&sender=481234567\n' "1%3A48""1234567%3Aweb%3Aab12cd" > site/a.html
  out="$(check site || true)"
  assert_contains "$out" "site/a.html line 1: Firebase app id"
  printf 'app=%s\n' "1%3a48""1234567%3aandroid%3aab12" > site/a.html
  assert_status 1 "$script" site
  # the documentation example uses a short made-up project number
  printf 'app=%s\n' "1%3A55501%3Aweb%3A5ca1ab1e" > site/a.html
  assert_status 0 "$script" site
}
test_project_hosts_fail() {
  site; printf '%s\n%s\n' "$host" "https://$pages_host/x" > site/docs.html
  out="$(check site || true)"
  assert_contains "$out" "site/docs.html line 1: Firebase project host"
  assert_contains "$out" "site/docs.html line 2: Firebase project host"
}
test_only_demo_hosts_are_allowed() {
  site; printf 'authDomain: "demo-springfield.firebaseapp.com"\n' > site/docs.html
  assert_status 0 "$script" site
  printf 'x.demo-springfield.%s\n' "firebaseapp.com" > site/docs.html
  assert_status 0 "$script" site
  printf 'notdemo-springfield.%s\n' "firebaseapp.com" > site/docs.html
  assert_status 1 "$script" site
}
test_a_key_inside_a_binary_file_fails() {
  site; { printf '\x00\x01PNG'; printf '%s' "$key"; printf '\x00'; } > site/assets/image.png
  out="$(check site || true)"
  assert_contains "$out" "site/assets/image.png"
}
test_nested_directories_are_scanned() {
  site; mkdir -p site/docs/deep; printf '%s\n' "$app_id" > site/docs/deep/page.html
  assert_status 1 "$script" site
}
test_usage_errors() {
  assert_status 2 "$script"
  assert_status 2 "$script" missing-dir
}
test_storage_bucket_hosts_fail() {
  site; printf '%s\n%s\n' "$bucket_host" "$appspot_host" > site/a.js
  out="$(check site || true)"
  assert_contains "$out" "site/a.js line 1: Firebase project host"
  assert_contains "$out" "site/a.js line 2: Firebase project host"
  printf 'demo-springfield.%s\n' "appspot.com" > site/a.js
  assert_status 0 "$script" site
}
test_a_recaptcha_site_key_fails_without_printing_it() {
  site; printf 'siteKey:"%s"\n' "$site_key" > site/a.js
  out="$(check site || true)"
  assert_contains "$out" "site/a.js line 1: reCAPTCHA site key"
  [[ "$out" != *"$site_key"* ]] || fail "the site key was printed"
  # part of a longer token is not a site key
  printf 'x%sx\n' "$site_key" > site/a.js
  assert_status 0 "$script" site
}
test_a_symlinked_file_or_directory_is_followed() {
  site; mkdir -p outside/dir
  printf '%s\n' "$key" > outside/secret.js; printf '%s\n' "$app_id" > outside/dir/b.js
  ln -s ../../outside/secret.js site/assets/linked.js
  ln -s ../outside/dir site/linked-dir
  out="$(check site || true)"
  assert_contains "$out" "site/assets/linked.js line 1: Firebase web API key"
  assert_contains "$out" "site/linked-dir/b.js line 1: Firebase app id"
}
test_an_unreadable_file_fails() {
  [[ "$(id -u)" -ne 0 ]] || return 0  # root reads everything
  site; echo 'nothing here' > site/assets/locked.js; chmod 000 site/assets/locked.js
  assert_status 2 "$script" site
  out="$(check site || true)"
  assert_contains "$out" "could not read everything"
  chmod 600 site/assets/locked.js
}
test_a_broken_symlink_fails() {
  site; ln -s ../missing.js site/assets/gone.js
  assert_status 2 "$script" site
}
test_the_maintainer_project_id_fails_when_configured() {
  site; mkdir -p conf
  printf '{"project_info": {"project_id": "springfield-maint-555"}}\n' > conf/google-services.json
  echo 'const p = "springfield-maint-555";' > site/assets/x.js
  # without the variable the check is skipped
  assert_status 0 "$script" site
  out="$(LEAK_CHECK_CONFIG=conf/google-services.json "$script" site 2>&1 || true)"
  assert_contains "$out" "site/assets/x.js line 1: the maintainer's project id"
  [[ "$out" != *"springfield-maint-555"* ]] || fail "the project id was printed"
  printf 'const firebaseConfig = { projectId: "springfield-other-555" };\n' > conf/web.js
  assert_status 0 env LEAK_CHECK_CONFIG=conf/web.js "$script" site
  assert_status 2 env LEAK_CHECK_CONFIG=conf/missing.json "$script" site
}
run_tests

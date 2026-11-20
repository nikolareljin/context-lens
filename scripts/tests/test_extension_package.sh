#!/usr/bin/env bash
# shellcheck disable=SC2329,SC2164  # test functions are found by name
source "$(dirname "${BASH_SOURCE[0]}")/assert.sh"

# A throwaway repository with the packaging scripts, VERSION 0.3.0 and a clean extension build.
setup_repo() {
  mkdir -p repo/scripts/lib repo/apps/web/dist-extension/assets && cd repo && ln -s apps/web/dist-extension build
  cp "$TL_ROOT/scripts/extension-package.sh" "$TL_ROOT/scripts/site-leak-check.sh" scripts/
  cp "$TL_ROOT/scripts/lib/common.sh" scripts/lib/
  echo 0.3.0 > VERSION
  manifest '{"manifest_version":3,"name":"ContextLens","version":"0.3.0","permissions":["sidePanel"],"side_panel":{"default_path":"sidepanel.html"}}'
  echo '<!doctype html><script type="module" src="./assets/a.js"></script>' > build/sidepanel.html
  echo 'export const a = "on-device-only";' > build/assets/a.js
}
manifest() { echo "$1" > build/manifest.json; }
package() { bash scripts/extension-package.sh 2>&1; }

test_packages_a_clean_build_with_its_checksum() {
  setup_repo
  package >/dev/null || fail "packaging failed: $(package)"
  [[ -f dist/context-lens-extension.zip ]] || fail "no zip"
  (cd dist && sha256sum -c --quiet context-lens-extension.zip.sha256) || fail "checksum does not match"
  assert_contains "$(unzip -Z1 dist/context-lens-extension.zip)" "manifest.json"
  [[ "$(unzip -Z1 dist/context-lens-extension.zip)" != *build/* ]] || fail "files are not at the root of the zip"
}
test_refuses_a_version_other_than_VERSION() {
  setup_repo
  manifest '{"manifest_version":3,"version":"0.2.0","permissions":["sidePanel"]}'
  assert_contains "$(package || true)" "version differs from VERSION"
  [[ ! -e dist/context-lens-extension.zip ]] || fail "a zip was written"
}
test_refuses_more_permissions_or_host_access() {
  setup_repo
  manifest '{"manifest_version":3,"version":"0.3.0","permissions":["sidePanel","tabs"]}'
  assert_contains "$(package || true)" "more than the side panel"
  manifest '{"manifest_version":3,"version":"0.3.0","permissions":["sidePanel"],"host_permissions":["<all_urls>"]}'
  assert_contains "$(package || true)" "host access"
  manifest '{"manifest_version":3,"version":"0.3.0","permissions":["sidePanel"],"content_security_policy":{"extension_pages":"script-src * "}}'
  assert_contains "$(package || true)" "content security policy"
}
test_refuses_app_check_or_auth_popup_code() {
  setup_repo
  echo 'fetch(u+":exchangeRecaptchaEnterpriseToken")' > build/assets/b.js
  assert_contains "$(package || true)" "App Check or the Auth popup loader"
  rm build/assets/b.js; echo 'window.gapi.iframes.getContext()' > build/assets/c.js
  assert_contains "$(package || true)" "App Check or the Auth popup loader"
}
test_refuses_a_remote_script_in_a_page() {
  setup_repo
  echo '<script src="https://example.invalid/x.js"></script>' >> build/sidepanel.html
  assert_contains "$(package || true)" "remote script"
}
test_refuses_a_firebase_key() {
  setup_repo
  printf 'x={apiKey:"%s"}\n' "AI""za$(printf 'Q%.0s' {1..35})" > build/assets/a.js
  assert_status 1 bash scripts/extension-package.sh
  [[ ! -e dist/context-lens-extension.zip ]] || fail "a zip was written"
}
test_takes_no_arguments() {
  setup_repo
  assert_status 2 bash scripts/extension-package.sh /etc out
}
test_missing_build_is_explained() {
  setup_repo; rm build/manifest.json
  assert_contains "$(package || true)" "no extension build"
}
run_tests

#!/usr/bin/env bash
# shellcheck disable=SC2329,SC2164  # test functions are found by name
source "$(dirname "${BASH_SOURCE[0]}")/assert.sh"
script="$TL_ROOT/scripts/extension-install.sh"

# release/: a zipped extension (manifest name ContextLens, version $1) and its .sha256.
release() {
  mkdir -p pkg release
  printf '{\n  "manifest_version": 3,\n  "name": "ContextLens",\n  "version": "%s"\n}\n' "${1:-0.3.0}" > pkg/manifest.json
  echo '<!doctype html>' > pkg/sidepanel.html
  (cd pkg && zip -q -r ../release/context-lens-extension.zip .)
  (cd release && sha256sum context-lens-extension.zip > context-lens-extension.zip.sha256)
}
# A stand-in browser and clipboard that record what they were given.
stubs() {
  printf '#!/usr/bin/env bash\nprintf "%%s\\n" "$@" > %s/browser-args\n' "$PWD" > browser
  printf '#!/usr/bin/env bash\ncat > %s/clipboard\n' "$PWD" > copy
  chmod +x browser copy
}
install() {
  HOME="$PWD/home" CONTEXTLENS_RELEASE_URL="file://$PWD/release" CONTEXTLENS_WSL=0 \
    CONTEXTLENS_COPY="$PWD/copy" "$@" bash "$script" 2>&1
}

test_loads_it_in_chromium_with_its_own_profile() {
  release; stubs; mkdir home
  out="$(install env CONTEXTLENS_BROWSER="$PWD/browser")" || fail "install failed: $out"
  assert_contains "$(cat home/context-lens/extension/manifest.json)" '"version": "0.3.0"'
  for _ in 1 2 3 4 5 6 7 8 9 10; do [[ -s browser-args ]] && break; sleep 0.2; done
  args="$(cat browser-args 2>/dev/null)"
  assert_contains "$args" "--load-extension=$PWD/home/context-lens/extension"
  assert_contains "$args" "--user-data-dir=$PWD/home/context-lens/browser-profile"
  assert_contains "$args" "chrome-extension://ibebpiolnohegpeabdgikjjnolphpbcd/sidepanel.html"
  assert_contains "$out" "checksum ok"
}
test_no_launch_only_prints_the_command() {
  release; stubs; mkdir home
  out="$(HOME="$PWD/home" CONTEXTLENS_RELEASE_URL="file://$PWD/release" CONTEXTLENS_WSL=0 CONTEXTLENS_BROWSER="$PWD/browser" bash "$script" --no-launch 2>&1)" || fail "install failed: $out"
  sleep 0.5
  [[ ! -e browser-args ]] || fail "the browser was started"
  assert_contains "$out" "--load-extension="
}
test_guides_chrome_users_and_copies_the_path() {
  release; stubs; mkdir home
  out="$(install env CONTEXTLENS_BROWSER=none CONTEXTLENS_CHROME="$PWD/browser")" || fail "install failed: $out"
  for _ in 1 2 3 4 5 6 7 8 9 10; do [[ -s browser-args ]] && break; sleep 0.2; done
  assert_eq "$(cat browser-args)" "chrome://extensions"
  assert_eq "$(cat clipboard)" "$PWD/home/context-lens/extension"
  assert_contains "$out" "Developer mode"
  assert_contains "$out" "Load unpacked"
  assert_contains "$out" "already copied"
}
test_updates_in_place() {
  release 0.3.0; stubs; mkdir home
  install env CONTEXTLENS_BROWSER=none CONTEXTLENS_CHROME=none >/dev/null || fail "first install failed"
  rm -rf pkg release; release 0.3.1
  install env CONTEXTLENS_BROWSER=none CONTEXTLENS_CHROME=none >/dev/null || fail "update failed"
  assert_contains "$(cat home/context-lens/extension/manifest.json)" '"version": "0.3.1"'
}
test_refuses_a_damaged_download() {
  release; stubs; mkdir home
  echo "0000000000000000000000000000000000000000000000000000000000000000  context-lens-extension.zip" > release/context-lens-extension.zip.sha256
  out="$(install env CONTEXTLENS_BROWSER=none CONTEXTLENS_CHROME=none)" && fail "a damaged download was installed"
  assert_contains "$out" "checksum mismatch"
  [[ ! -e home/context-lens/extension ]] || fail "something was unpacked"
  assert_eq "$(ls -A home/context-lens)" ""
}
test_never_replaces_a_folder_that_is_not_the_extension() {
  release; stubs; mkdir -p home/context-lens/extension
  echo keep > home/context-lens/extension/notes.txt
  out="$(install env CONTEXTLENS_BROWSER=none CONTEXTLENS_CHROME=none)" && fail "an unrelated folder was replaced"
  assert_contains "$out" "is not a ContextLens extension folder"
  assert_eq "$(cat home/context-lens/extension/notes.txt)" keep
}
test_wsl_points_to_powershell_without_downloading() {
  stubs; mkdir home
  out="$(HOME="$PWD/home" CONTEXTLENS_RELEASE_URL="file://$PWD/missing" CONTEXTLENS_WSL=1 bash "$script" 2>&1)" || fail "failed: $out"
  assert_contains "$out" "extension-install.ps1 | iex"
  [[ ! -e home/context-lens ]] || fail "something was installed"
}
test_a_release_without_the_extension_is_explained() {
  stubs; mkdir home bin
  printf '#!/usr/bin/env bash\nprintf 404\n' > bin/curl; chmod +x bin/curl
  out="$(HOME="$PWD/home" PATH="$PWD/bin:$PATH" CONTEXTLENS_WSL=0 CONTEXTLENS_BROWSER=none CONTEXTLENS_CHROME=none bash "$script" 2>&1)" \
    && fail "a missing extension was not reported"
  assert_contains "$out" "has no Chrome extension yet"
  assert_eq "$(ls -A home/context-lens)" ""
}
test_leaves_only_the_extension_behind() {
  release; stubs; mkdir home
  install env CONTEXTLENS_BROWSER=none CONTEXTLENS_CHROME=none >/dev/null || fail "install failed"
  assert_eq "$(ls -A home/context-lens)" "extension"
}
test_rejects_a_bad_version() {
  assert_status 1 bash "$script" --version v1
}
run_tests

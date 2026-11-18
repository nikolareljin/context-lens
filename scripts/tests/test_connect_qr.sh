#!/usr/bin/env bash
# shellcheck disable=SC2329  # test functions are found by name
source "$(dirname "${BASH_SOURCE[0]}")/assert.sh"
script="$TL_ROOT/scripts/connect-qr.sh"

# Made-up values in the shape of a real project's; not a working key.
config() {
  local key="AIza$(printf 'x%.0s' {1..35})"
  cat > gs.json <<JSON
{"project_info": {"project_number": "555000000000", "project_id": "${1:-my-own-project}"},
 "client": [{"client_info": {"mobilesdk_app_id": "1:555000000000:android:0123456789abcdef",
   "android_client_info": {"package_name": "com.contextlens.app"}},
   "api_key": [{"current_key": "$key"}]}]}
JSON
}
# Stands in for segno's Python: writes the code it read on stdin to the image path.
stub_python() {
  printf '#!/usr/bin/env bash\ncat > "$3"\n' > fakepy
  chmod +x fakepy
  export CONNECT_QR_PYTHON="$PWD/fakepy"
}

test_code_is_written_as_image_and_text() {
  config; stub_python
  bash "$script" gs.json "$PWD/out" >/dev/null 2>&1 || fail "script failed"
  assert_contains "$(cat out/connect-code.txt)" "contextlens-connect:1?project=my-own-project&app=1%3A555000000000%3Aandroid%3A0123456789abcdef&key=AIza"
  assert_eq "$(cat out/connect-qr.png)" "$(tr -d '\n' < out/connect-code.txt)"
  assert_eq "$(stat -c %a out/connect-qr.png)$(stat -c %a out/connect-code.txt)" 600600
}
test_key_is_never_printed() {
  config; stub_python
  out="$(bash "$script" gs.json "$PWD/out" 2>&1)"
  [[ "$out" != *AIza* ]] || fail "the key was printed"
}
test_refuses_the_repository_and_its_symlinks() {
  config; stub_python
  assert_status 1 bash "$script" gs.json "$TL_ROOT/apps"
  ln -s "$TL_ROOT/apps" link
  assert_status 1 bash "$script" gs.json "$PWD/link"
  [[ ! -e "$TL_ROOT/apps/connect-qr.png" ]] || { rm -f "$TL_ROOT/apps/connect-qr.png" "$TL_ROOT/apps/connect-code.txt"; fail "written inside the repository"; }
}
test_refuses_any_git_checkout() {
  config; stub_python
  git init -q other
  assert_status 1 bash "$script" gs.json "$PWD/other"
}
test_refuses_a_symlinked_output_file() {
  config; stub_python
  mkdir out && ln -s "$PWD/elsewhere.txt" out/connect-code.txt
  assert_status 1 bash "$script" gs.json "$PWD/out"
}
test_placeholder_is_refused() {
  config placeholder-project; stub_python
  assert_status 1 bash "$script" gs.json "$PWD/out"
}
run_tests

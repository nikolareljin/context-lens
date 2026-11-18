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
# A stand-in for segno that writes the link it was given, so the test can read it.
stub_segno() {
  mkdir -p bin
  printf '#!/usr/bin/env bash\nwhile [[ $# -gt 1 ]]; do [[ $1 == --output ]] && out=$2; shift; done\nprintf "%%s" "$1" > "$out"\n' > bin/segno
  chmod +x bin/segno
  export PATH="$PWD/bin:$PATH"
}

test_link_carries_the_values_in_the_fragment() {
  config; stub_segno
  bash "$script" gs.json "$PWD/qr.png" >/dev/null 2>&1 || fail "script failed"
  link="$(cat qr.png)"
  assert_contains "$link" "https://nikolareljin.github.io/context-lens/connect/#project=my-own-project&app=1%3A555000000000%3Aandroid%3A0123456789abcdef&key=AIza"
  assert_eq "$(stat -c %a qr.png)" 600
}
test_key_is_never_printed() {
  config; stub_segno
  out="$(bash "$script" gs.json "$PWD/qr.png" 2>&1)"
  [[ "$out" != *AIza* ]] || fail "the key was printed"
}
test_refuses_to_write_inside_the_repository() {
  config; stub_segno
  assert_status 1 bash "$script" gs.json "$TL_ROOT/qr.png"
  [[ ! -e "$TL_ROOT/qr.png" ]] || { rm -f "$TL_ROOT/qr.png"; fail "QR written inside the repository"; }
}
test_placeholder_is_refused() {
  config placeholder-project; stub_segno
  assert_status 1 bash "$script" gs.json "$PWD/qr.png"
}
run_tests

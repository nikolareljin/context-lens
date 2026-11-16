#!/usr/bin/env bash
# shellcheck disable=SC2329  # test functions are found by name
source "$(dirname "${BASH_SOURCE[0]}")/assert.sh"
script="$TL_ROOT/scripts/privacy-check.sh"

# Values are assembled at run time so this file itself passes the check.
at="@"
real_email="jordan${at}acme-mail.io"
real_phone="212 86""7 0134"
fake_phone="212 55""5 0134"
real_app_id="1:48""1234567:android:ab12"

repo() {
  git init -q -b main . && git config user.name t && git config user.email t@example.invalid
  echo "hello" > readme.md
  git add -A && git commit -q -m "chore: start"
}
# check [args...]
check() { "$script" "$@" 2>&1; }

test_a_clean_tree_passes() {
  repo
  printf 'mail me%sexample.com or %s\nnoreply: x%susers.noreply.github.com\n' "$at" "$fake_phone" "$at" > a.md
  assert_status 0 check
}
test_a_real_email_fails() {
  repo; echo "write to $real_email" > a.md
  out="$(check || true)"
  assert_contains "$out" "a.md:1: email address outside the example domains"
}
test_a_phone_outside_555_fails_even_next_to_a_fake_one() {
  repo; echo "call $fake_phone or $real_phone" > a.md
  out="$(check || true)"
  assert_contains "$out" "a.md:1: phone number outside 555"
}
test_firebase_ids_fail_but_placeholders_pass() {
  repo; echo "\"mobilesdk_app_id\": \"$real_app_id\"" > a.json
  out="$(check || true)"
  assert_contains "$out" "a.json:1: Firebase identifier"
  echo "\"mobilesdk_app_id\": \"1:000000000000:android:0000\", host demo-x.firebaseapp.com" > a.json
  assert_status 0 check
}
test_phones_without_separators_fail() {
  repo; printf '%s\n' "(212)86""7-0134" "21286""70134" "+1 212 86""7 0134" > a.md
  out="$(check || true)"
  assert_contains "$out" "a.md:1: phone"
  assert_contains "$out" "a.md:2: phone"
  assert_contains "$out" "a.md:3: phone"
  printf '%s\n' "(212)55""5-0134" "id abc21286""70134def" > a.md
  assert_status 0 check
}
test_the_author_email_is_checked() {
  repo; base="$(git rev-parse HEAD)"
  git -c user.email="$real_email" commit -q --allow-empty -m "fix: x"
  out="$(check --range "$base..HEAD" || true)"
  assert_contains "$out" "author/committer:1: email address"
}
test_a_merge_resolution_is_checked() {
  repo; base="$(git rev-parse HEAD)"
  git checkout -q -b side; echo side > s.md; git add s.md; git commit -q -m "docs: side"
  git checkout -q main; echo main > m.md; git add m.md; git commit -q -m "docs: main"
  git merge -q --no-commit side >/dev/null 2>&1 || true
  echo "$real_email" > r.md; git add r.md; git commit -q -m "chore: merge"
  git rm -q r.md; git commit -q -m "chore: drop"
  out="$(check --range "$base..HEAD" || true)"
  assert_contains "$out" ":r.md:1: email address"
}
test_coordinates_fail() {
  repo; echo "at 40.7128""1, -74.0060""2" > a.md
  out="$(check || true)"
  assert_contains "$out" "a.md:1: coordinates"
}
test_the_range_catches_data_removed_later() {
  repo; base="$(git rev-parse HEAD)"
  echo "$real_email" > a.md; git add a.md; git commit -q -m "docs: add"
  echo "gone" > a.md; git add a.md; git commit -q -m "docs: remove"
  assert_status 0 check
  out="$(check --range "$base..HEAD" || true)"
  assert_contains "$out" ":a.md:1: email address"
}
test_a_commit_message_is_checked() {
  repo; base="$(git rev-parse HEAD)"
  git commit -q --allow-empty -m "fix: thanks $real_email"
  out="$(check --range "$base..HEAD" || true)"
  assert_contains "$out" "message:1: email address"
}
test_a_bad_range_fails() {
  repo
  assert_status 1 check --range "nope..HEAD"
}
test_an_image_with_gps_fails() {
  command -v exiftool >/dev/null 2>&1 || { echo "    (exiftool missing: skipped)"; return 0; }
  repo
  # a valid 1x1 PNG, written here so no binary sits in the repository
  python3 -c 'import struct,sys,zlib
def chunk(t, d): return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d))
sys.stdout.buffer.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(b"\0\0\0\0")) + chunk(b"IEND", b""))' > p.png
  assert_status 0 check
  exiftool -q -overwrite_original -GPSLatitude=1.5 -GPSLatitudeRef=N p.png
  out="$(check || true)"
  assert_contains "$out" "p.png: file carries GPS"
}

run_tests

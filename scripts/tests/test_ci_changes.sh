#!/usr/bin/env bash
# shellcheck disable=SC2329  # test functions are found by name
source "$(dirname "${BASH_SOURCE[0]}")/assert.sh"
script="$TL_ROOT/scripts/ci-changes.sh"

repo() {
  git init -q -b main . && git config user.name t && git config user.email t@example.invalid
  git commit -q --allow-empty -m base
}
commit_file() { mkdir -p "$(dirname "$1")"; echo x >> "$1"; git add "$1"; git commit -q -m "c $1"; }

test_docs_only_marks_nothing() {
  repo; commit_file apps/android/gradlew; base="$(git rev-parse HEAD)"
  commit_file docs/x.md
  out="$(bash "$script" "$base" HEAD)"
  assert_contains "$out" "android=false"
}
test_android_change_marks_android() {
  repo; commit_file apps/android/gradlew; base="$(git rev-parse HEAD)"
  commit_file apps/android/app/x.kt
  out="$(bash "$script" "$base" HEAD)"
  assert_contains "$out" "android=true"
  assert_contains "$out" "functions=false"
}
test_eval_set_change_marks_android() {
  repo; commit_file apps/android/gradlew; base="$(git rev-parse HEAD)"
  commit_file eval/utterances.yaml
  out="$(bash "$script" "$base" HEAD)"
  assert_contains "$out" "android=true"
}
test_eval_set_change_marks_web() {
  repo; commit_file apps/web/package.json; base="$(git rev-parse HEAD)"
  commit_file eval/utterances.yaml
  out="$(bash "$script" "$base" HEAD)"
  assert_contains "$out" "web=true"
}
test_prompt_change_marks_web() {
  repo; commit_file apps/web/package.json; base="$(git rev-parse HEAD)"
  commit_file apps/android/app/src/main/assets/prompts/gatekeeper.v2.txt
  out="$(bash "$script" "$base" HEAD)"
  assert_contains "$out" "web=true"
}
test_ci_change_marks_present_areas_only() {
  repo; commit_file apps/android/gradlew; base="$(git rev-parse HEAD)"
  commit_file .github/workflows/ci.yml
  out="$(bash "$script" "$base" HEAD)"
  assert_contains "$out" "android=true"
  assert_contains "$out" "web=false"
}
test_absent_area_is_false() {
  repo; base="$(git rev-parse HEAD)"
  commit_file functions/x.ts
  rm -rf functions && git rm -rq functions && git commit -q -m rm
  out="$(bash "$script" "$base" HEAD)"
  assert_contains "$out" "functions=false"
}
test_docs_change_marks_docs() {
  repo; commit_file mkdocs.yml; base="$(git rev-parse HEAD)"
  commit_file docs/index.md
  out="$(bash "$script" "$base" HEAD)"
  assert_contains "$out" "docs=true"
  assert_contains "$out" "android=false"
}
test_docs_theme_change_marks_docs() {
  repo; commit_file mkdocs.yml; base="$(git rev-parse HEAD)"
  commit_file docs-overrides/main.html
  out="$(bash "$script" "$base" HEAD)"
  assert_contains "$out" "docs=true"
}
run_tests

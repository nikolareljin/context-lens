#!/usr/bin/env bash
# shellcheck disable=SC2329,SC2164  # test functions are found by name
source "$(dirname "${BASH_SOURCE[0]}")/assert.sh"

# A throwaway copy of the scripts with a bare "origin" next to it.
setup_repo() {
  git init -q --bare origin.git
  git init -q -b main work && cd work
  git config user.name t && git config user.email t@example.invalid
  mkdir -p scripts/lib && cp "$TL_ROOT/scripts/release.sh" "$TL_ROOT/scripts/release-notes.sh" scripts/
  cp "$TL_ROOT/scripts/lib/common.sh" scripts/lib/
  echo "$1" > VERSION
  printf '# Changelog\n\n## [Unreleased]\n\n## [%s] - 2026-11-13\n\n- first\n' "$2" > CHANGELOG.md
  git add -A && git commit -q -m "chore: release $1"
  git remote add origin ../origin.git && git push -q origin main
}

test_release_dry_run_passes_when_ready() {
  setup_repo 0.1.0 0.1.0
  out="$(bash scripts/release.sh --dry-run 2>&1)"
  assert_contains "$out" "would tag 0.1.0"
}
test_release_refuses_prefixed_version() {
  setup_repo v0.1.0 0.1.0
  assert_status 1 bash scripts/release.sh --dry-run
}
test_release_refuses_missing_changelog_section() {
  setup_repo 0.2.0 0.1.0
  assert_status 1 bash scripts/release.sh --dry-run
}
test_release_refuses_a_different_web_package_version() {
  setup_repo 0.2.0 0.2.0
  mkdir -p apps/web && echo '{ "version": "0.1.1" }' > apps/web/package.json
  git add -A && git commit -q -m "chore: web" && git push -q origin main
  assert_status 1 bash scripts/release.sh --dry-run
  echo '{ "version": "0.2.0" }' > apps/web/package.json
  git add -A && git commit -q -m "chore: web" && git push -q origin main
  assert_status 0 bash scripts/release.sh --dry-run
  echo '{ "version": "0.2.0", "packages": { "": { "version": "0.1.1" } } }' > apps/web/package-lock.json
  git add -A && git commit -q -m "chore: web lock" && git push -q origin main
  assert_status 1 bash scripts/release.sh --dry-run
}
test_release_refuses_dirty_tree() {
  setup_repo 0.1.0 0.1.0
  echo y > extra
  assert_status 1 bash scripts/release.sh --dry-run
}
test_release_refuses_other_branch() {
  setup_repo 0.1.0 0.1.0
  git switch -q -c feat/x
  assert_status 1 bash scripts/release.sh --dry-run
}
test_release_tags_and_pushes_then_refuses_repeat() {
  setup_repo 0.1.0 0.1.0
  bash scripts/release.sh >/dev/null 2>&1 || fail "release failed"
  git -C ../origin.git rev-parse -q --verify refs/tags/0.1.0 >/dev/null || fail "tag not pushed"
  assert_status 1 bash scripts/release.sh --dry-run
}
test_release_notes_print_the_section() {
  setup_repo 0.1.0 0.1.0
  git tag -a 0.1.0 -m 0.1.0
  out="$(bash scripts/release-notes.sh 0.1.0)"
  assert_contains "$out" "- first"
  [[ "$out" != *"Unreleased"* ]] || fail "notes ran into another section"
}
test_release_notes_list_merge_and_squash_prs() {
  setup_repo 0.1.0 0.1.0
  git tag -a 0.1.0 -m 0.1.0
  git switch -q -c feat/a && git commit -q --allow-empty -m "feat: scanner"
  git switch -q main && git merge -q --no-ff feat/a -m "Merge pull request #7 from owner/feat/a" -m "feat: scanner"
  git commit -q --allow-empty -m "fix: crash on empty label (#8)"
  git commit -q --allow-empty -m "chore: not from a pull request"
  echo 0.1.1 > VERSION
  printf '# Changelog\n\n## [Unreleased]\n\n## [0.1.1] - 2026-11-14\n\n- fixes\n\n## [0.1.0] - 2026-11-13\n\n- first\n' > CHANGELOG.md
  git commit -qam "chore(release): 0.1.1 (#9)" && git tag -a 0.1.1 -m 0.1.1
  out="$(bash scripts/release-notes.sh 0.1.1 https://example.invalid/r)"
  assert_contains "$out" "- feat: scanner (#7)"
  assert_contains "$out" "- fix: crash on empty label (#8)"
  assert_contains "$out" "- chore(release): 0.1.1 (#9)"
  [[ "$out" != *"not from a pull request"* ]] || fail "a direct commit was listed"
  assert_contains "$out" "compare/0.1.0...0.1.1"
}
test_release_notes_previous_tag_is_the_highest_below() {
  setup_repo 0.2.0 0.2.0
  git tag 0.1.0 && git tag 0.3.0 && git tag -a 0.2.0 -m 0.2.0
  out="$(bash scripts/release-notes.sh 0.2.0 https://example.invalid/r)"
  assert_contains "$out" "compare/0.1.0...0.2.0"
}
run_tests

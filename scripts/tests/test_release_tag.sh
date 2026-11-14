#!/usr/bin/env bash
# shellcheck disable=SC2329,SC2164  # test functions are found by name
source "$(dirname "${BASH_SOURCE[0]}")/assert.sh"

# A repository whose HEAD is a merged release/<branch-version> with VERSION <file-version>.
setup_repo() {
  git init -q --bare origin.git
  git init -q -b main work && cd work
  git config user.name t && git config user.email t@example.invalid
  mkdir -p scripts/lib
  cp "$TL_ROOT/scripts/release-tag.sh" scripts/ && cp "$TL_ROOT/scripts/lib/common.sh" scripts/lib/
  echo "$1" > VERSION
  printf '# Changelog\n\n## [Unreleased]\n\n## [%s] - 2026-11-14\n\n- first\n' "${2:-$1}" > CHANGELOG.md
  git add -A && git commit -q -m "chore(release): $1"
  git remote add origin ../origin.git && git push -q origin main
  sha="$(git rev-parse HEAD)"
}

test_tags_the_merge_commit() {
  setup_repo 0.1.0
  out="$PWD/out"; : > "$out"
  GITHUB_OUTPUT="$out" bash scripts/release-tag.sh release/0.1.0 "$sha" >/dev/null 2>&1 || fail "tagging failed"
  assert_eq "$(git -C ../origin.git rev-parse '0.1.0^{commit}')" "$sha"
  assert_eq "$(cat "$out")" "tag=0.1.0"
}
test_refuses_non_release_branch() {
  setup_repo 0.1.0
  assert_status 1 bash scripts/release-tag.sh feat/x "$sha"
}
test_refuses_prefixed_branch_version() {
  setup_repo 0.1.0
  assert_status 1 bash scripts/release-tag.sh release/v0.1.0 "$sha"
}
test_refuses_version_mismatch() {
  setup_repo 0.1.0
  assert_status 1 bash scripts/release-tag.sh release/0.2.0 "$sha"
}
test_refuses_missing_changelog_section() {
  setup_repo 0.2.0 0.1.0
  assert_status 1 bash scripts/release-tag.sh release/0.2.0 "$sha"
}
test_refuses_existing_remote_tag() {
  setup_repo 0.1.0
  git tag 0.1.0 && git push -q origin 0.1.0 && git tag -d 0.1.0 >/dev/null
  assert_status 1 bash scripts/release-tag.sh release/0.1.0 "$sha"
}
run_tests

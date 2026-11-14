#!/usr/bin/env bash
# shellcheck disable=SC2329,SC2164  # test functions are found by name
source "$(dirname "${BASH_SOURCE[0]}")/assert.sh"

# A throwaway repository with the release scripts and a bare "origin".
setup_repo() {
  git init -q --bare origin.git
  git init -q -b main work && cd work
  git config user.name t && git config user.email t@example.invalid
  mkdir -p scripts/lib
  cp "$TL_ROOT/scripts/version.sh" "$TL_ROOT/scripts/release-notes.sh" scripts/
  cp "$TL_ROOT/scripts/lib/common.sh" scripts/lib/
  echo "${1:-0.0.1}" > VERSION
  printf '# Changelog\n\n## [Unreleased]\n\n### Added\n\n- something\n' > CHANGELOG.md
  git add -A && git commit -q -m "chore: start"
  git remote add origin ../origin.git && git push -q origin main
}
commit() { git commit -q --allow-empty -m "$1" && git push -q origin main; }

test_first_feat_gives_minor() {
  setup_repo 0.0.1; commit "feat: scanner"
  assert_eq "$(bash scripts/version.sh --dry-run 2>/dev/null)" 0.1.0
}
test_fix_after_tag_gives_patch() {
  setup_repo 0.1.0; git tag 0.1.0; commit "fix: crash"
  assert_eq "$(bash scripts/version.sh --dry-run 2>/dev/null)" 0.1.1
}
test_feat_after_tag_gives_minor() {
  setup_repo 0.1.0; git tag 0.1.0; commit "fix: crash"; commit "feat(scan): barcode"
  assert_eq "$(bash scripts/version.sh --dry-run 2>/dev/null)" 0.2.0
}
test_breaking_is_minor_while_zero() {
  setup_repo 0.3.0; git tag 0.3.0; commit "feat!: new storage"
  assert_eq "$(bash scripts/version.sh --dry-run 2>/dev/null)" 0.4.0
}
test_breaking_is_major_after_one() {
  setup_repo 1.2.0; git tag 1.2.0; commit "refactor(db)!: new schema"
  assert_eq "$(bash scripts/version.sh --dry-run 2>/dev/null)" 2.0.0
}
test_explicit_level_and_version() {
  setup_repo 0.4.2; git tag 0.4.2; commit "docs: x"
  assert_eq "$(bash scripts/version.sh major --dry-run 2>/dev/null)" 1.0.0
  assert_eq "$(bash scripts/version.sh 0.9.0 --dry-run 2>/dev/null)" 0.9.0
}
test_version_not_above_last_tag_is_refused() {
  setup_repo 0.4.2; git tag 0.4.2
  assert_status 1 bash scripts/version.sh 0.4.2 --dry-run
  assert_status 1 bash scripts/version.sh 0.3.9 --dry-run
}
test_prepares_branch_version_and_changelog() {
  setup_repo 0.0.1; commit "feat: scanner"
  bash scripts/version.sh >/dev/null 2>&1 || fail "version failed"
  assert_eq "$(git rev-parse --abbrev-ref HEAD)" release/0.1.0
  assert_eq "$(cat VERSION)" 0.1.0
  assert_contains "$(cat CHANGELOG.md)" "## [Unreleased]"
  grep -Eq '^## \[0\.1\.0\] - [0-9]{4}-[0-9]{2}-[0-9]{2}$' CHANGELOG.md || fail "dated heading missing"
  assert_eq "$(git log -1 --format=%s)" "chore(release): 0.1.0"
}
test_empty_unreleased_is_refused() {
  setup_repo 0.0.1
  printf '# Changelog\n\n## [Unreleased]\n\n## [0.0.1] - 2026-11-01\n\n- x\n' > CHANGELOG.md
  git commit -qam "docs: empty" && git push -q origin main
  assert_status 1 bash scripts/version.sh patch
}
test_refuses_outside_main() {
  setup_repo 0.0.1; git switch -q -c feat/x
  assert_status 1 bash scripts/version.sh patch
}
test_tags_only_on_the_remote_are_seen() {
  setup_repo 0.1.0; commit "fix: x"
  git tag 0.1.1 && git push -q origin 0.1.1 && git tag -d 0.1.1 >/dev/null
  assert_eq "$(bash scripts/version.sh --dry-run 2>/dev/null)" 0.1.2
}
test_existing_remote_release_branch_is_refused() {
  setup_repo 0.0.1; commit "fix: y"
  git push -q origin HEAD:refs/heads/release/0.0.2
  assert_status 1 bash scripts/version.sh patch
}
test_pr_flag_pushes_and_calls_gh() {
  setup_repo 0.0.1; commit "fix: y"
  printf '#!/usr/bin/env bash\necho "gh $*" >> "%s/gh-calls"\n' "$PWD" > ../gh && chmod +x ../gh
  GH="$PWD/../gh" bash scripts/version.sh --pr >/dev/null 2>&1 || fail "version --pr failed"
  git -C ../origin.git rev-parse -q --verify refs/heads/release/0.0.2 >/dev/null || fail "branch not pushed"
  assert_contains "$(cat gh-calls)" "pr create --base main --head release/0.0.2"
  assert_eq "$(git rev-parse --abbrev-ref HEAD)" main "checkout returns to main"
}
run_tests

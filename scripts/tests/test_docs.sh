#!/usr/bin/env bash
# shellcheck disable=SC2329  # test functions are found by name
source "$(dirname "${BASH_SOURCE[0]}")/assert.sh"
script="$TL_ROOT/scripts/docs.sh"

fake_mkdocs() {
  printf '#!/usr/bin/env bash\necho "mkdocs $*" >> "%s/calls"\n' "$PWD" > mkdocs && chmod +x mkdocs
  export MKDOCS="$PWD/mkdocs"
}

test_build_is_strict() {
  fake_mkdocs
  bash "$script" build >/dev/null 2>&1 || fail "build failed"
  assert_contains "$(cat calls)" "build --strict --site-dir site"
}
test_serve_uses_port() {
  fake_mkdocs
  DOCS_PORT=9123 bash "$script" serve >/dev/null 2>&1 || fail "serve failed"
  assert_contains "$(cat calls)" "--dev-addr 127.0.0.1:9123"
}
test_bad_port_is_refused() {
  fake_mkdocs
  assert_status 1 env DOCS_PORT='8008;x' bash "$script" serve
}
test_requirements_not_published() {
  if ! grep -Eq '^exclude_docs:' "$TL_ROOT/mkdocs.yml" || ! grep -q 'requirements.txt' "$TL_ROOT/mkdocs.yml"; then
    fail "docs/requirements.txt would be copied into the site"
  fi
}
test_unknown_command_fails() {
  fake_mkdocs
  assert_status 1 bash "$script" publish
}
test_pinned_version_present() {
  grep -Eq '^mkdocs-material==[0-9]+\.[0-9]+\.[0-9]+$' "$TL_ROOT/docs/requirements.txt" || fail "mkdocs-material is not pinned"
}
test_every_doc_is_in_nav() {
  local f missing=""
  for f in "$TL_ROOT"/docs/*.md; do
    grep -q " $(basename "$f")$" "$TL_ROOT/mkdocs.yml" || missing+=" $(basename "$f")"
  done
  [[ -z "$missing" ]] || fail "not in mkdocs nav:$missing"
}
run_tests

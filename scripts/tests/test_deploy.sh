#!/usr/bin/env bash
# shellcheck disable=SC2329  # test functions are found by name
source "$(dirname "${BASH_SOURCE[0]}")/assert.sh"

setup_tree() {
  mkdir -p scripts/lib && cp "$TL_ROOT/scripts/deploy.sh" scripts/ && cp "$TL_ROOT/scripts/lib/common.sh" scripts/lib/
  echo 0.0.1 > VERSION
  git init -q -b main . && git config user.name t && git config user.email t@example.invalid
  git add -A && git commit -q -m init
  printf '#!/usr/bin/env bash\necho "firebase $*" >> "%s/calls"\n' "$PWD" > fake-firebase && chmod +x fake-firebase
  export FIREBASE="$PWD/fake-firebase"
}

test_deploy_needs_project() {
  setup_tree; echo '{}' > firebase.json; mkdir -p firebase; touch firebase/firestore.rules
  assert_status 1 env -u FIREBASE_PROJECT_ID bash scripts/deploy.sh rules
}
test_deploy_rules_calls_firebase() {
  setup_tree; echo '{}' > firebase.json; mkdir -p firebase; touch firebase/firestore.rules
  FIREBASE_PROJECT_ID=demo-project bash scripts/deploy.sh rules >/dev/null 2>&1 || fail "deploy failed"
  assert_contains "$(cat calls)" "deploy --non-interactive --project demo-project --only firestore"
}
test_deploy_all_lists_present_parts_only() {
  setup_tree; echo '{}' > firebase.json; mkdir -p firebase functions; touch firebase/firestore.rules
  FIREBASE_PROJECT_ID=demo-project bash scripts/deploy.sh all >/dev/null 2>&1 || fail "deploy failed"
  assert_contains "$(cat calls)" "--only firestore,functions"
}
test_deploy_apk_uses_groups() {
  setup_tree; touch app.apk
  FIREBASE_PROJECT_ID=demo-project FIREBASE_ANDROID_APP_ID=1:2:android:3 TESTER_GROUPS=qa \
    bash scripts/deploy.sh apk app.apk >/dev/null 2>&1 || fail "distribute failed"
  assert_contains "$(cat calls)" "appdistribution:distribute app.apk"
  assert_contains "$(cat calls)" "--groups qa"
}
test_deploy_dry_run_calls_nothing() {
  setup_tree; echo '{}' > firebase.json; mkdir -p firebase; touch firebase/firestore.rules
  out="$(FIREBASE_PROJECT_ID=demo-project bash scripts/deploy.sh rules --dry-run 2>&1)"
  assert_contains "$out" "would run: firebase deploy"
  [[ ! -e calls ]] || fail "dry run called firebase"
}
run_tests

#!/usr/bin/env bash
# Set up the Firebase backend from this machine: sign in once, then every step
# that has an API runs here; the few console-only steps open the right page.
#
# Usage: scripts/cloud-setup.sh [step] [--yes] [--enforce]
#   all         every step below, in order (default); each one skips work already done
#   tools       install the Firebase CLI and the Google Cloud CLI under your home folder
#   login       sign in to both with your Google account (opens the browser)
#   project     create or pick the Firebase project; saved as FIREBASE_PROJECT_ID in .env
#   apis        enable the Google APIs the app uses; opens AI Logic to start the Gemini API
#   android     register the Android app, add the signing fingerprints, write google-services.json
#   web         register the web app, write apps/web/.env.local
#   firestore   create the Firestore database (FIRESTORE_LOCATION, default nam5)
#   auth        Google and anonymous sign-in, the Pages domain as an authorized domain
#   recaptcha   a score-based reCAPTCHA Enterprise key for the Pages domain and localhost
#   appcheck    register Play Integrity (Android) and reCAPTCHA Enterprise (web);
#               --enforce also enforces App Check on AI Logic
#   github      copy the configuration into this repository's Actions variables and secrets
#   status      what is done and what is left
#
#   --yes       answer yes to every question (installs, GitHub writes)
#
# Values are written to git-ignored files (.env, apps/web/.env.local,
# apps/android/app/google-services.json) and to GitHub; none is printed.
set -euo pipefail
shopt -s inherit_errexit
TL_TAG=cloud
# shellcheck source=lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
# shellcheck source=lib/cloud.sh
source "$TL_ROOT/scripts/lib/cloud.sh"
load_env "$TL_ENV_FILE"
need jq "apt install jq"

FB="$(firebase_bin)"; GC="$(gcloud_bin)"
FM="https://firebase.googleapis.com/v1beta1"
AC="https://firebaseappcheck.googleapis.com/v1"
IT="https://identitytoolkit.googleapis.com/admin/v2"
CONSOLE="https://console.firebase.google.com/project"
BIN_DIR="${BIN_DIR:-$HOME/.local/bin}"
GCLOUD_HOME="${GCLOUD_HOME:-$HOME/google-cloud-sdk}"
export PATH="$BIN_DIR:$PATH"   # tools installed by this run are usable right away
GSJ="${TL_ANDROID_DIR:-$TL_ROOT/apps/android}/app/google-services.json"
APIS=(firebasevertexai.googleapis.com generativelanguage.googleapis.com
  firebaseappcheck.googleapis.com recaptchaenterprise.googleapis.com
  firestore.googleapis.com firebaseremoteconfig.googleapis.com
  identitytoolkit.googleapis.com playintegrity.googleapis.com)

step="all"; enforce=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes) export ASSUME_YES=1 ;;
    --enforce) enforce=1 ;;
    -h|--help) usage_from "${BASH_SOURCE[0]}"; exit 0 ;;
    -*) die "unknown option: $1" 2 ;;
    *) step="$1" ;;
  esac
  shift
done

has() { command -v "$1" >/dev/null 2>&1; }
# fb <args>: firebase on the configured project. The explicit exit also holds
# where errexit is off (inside `cmd || ...`), so firebase never runs on no project.
fb() { local p; p="$(project_id)" || exit 1; "$FB" "$@" --project "$p"; }
done_msg() { printf '  done     %s\n' "$*" >&2; }

# ---- tools ---------------------------------------------------------------
step_tools() {
  mkdir -p "$BIN_DIR"
  if has "$FB"; then done_msg "Firebase CLI $("$FB" --version 2>/dev/null)"
  elif confirm "Install the Firebase CLI (standalone binary) to $BIN_DIR/firebase?"; then
    "$(curl_bin)" -fsSL https://firebase.tools/bin/linux/latest -o "$BIN_DIR/firebase.tmp"
    chmod +x "$BIN_DIR/firebase.tmp" && mv "$BIN_DIR/firebase.tmp" "$BIN_DIR/firebase"
    done_msg "Firebase CLI installed"
  else die "the Firebase CLI is needed"; fi

  if has "$GC"; then done_msg "Google Cloud CLI"
  elif [[ -x "$GCLOUD_HOME/bin/gcloud" ]]; then
    ln -sf "$GCLOUD_HOME/bin/gcloud" "$BIN_DIR/gcloud"; done_msg "Google Cloud CLI linked"
  elif confirm "Install the Google Cloud CLI to $GCLOUD_HOME?"; then
    local arch; arch="$(uname -m)"; [[ "$arch" == aarch64 ]] && arch=arm
    local tgz; tgz="$(mktemp -d)/gcloud.tar.gz"
    "$(curl_bin)" -fsSL -o "$tgz" \
      "https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/google-cloud-cli-linux-$arch.tar.gz"
    tar -xzf "$tgz" -C "$(dirname "$GCLOUD_HOME")"
    "$GCLOUD_HOME/install.sh" --quiet --usage-reporting false --path-update false >/dev/null
    ln -sf "$GCLOUD_HOME/bin/gcloud" "$BIN_DIR/gcloud"
    done_msg "Google Cloud CLI installed"
  else die "the Google Cloud CLI is needed"; fi
  [[ ":$PATH:" == *":$BIN_DIR:"* ]] || warn "$BIN_DIR is not on PATH; add it to your shell profile"
}

# ---- login ---------------------------------------------------------------
firebase_signed_in() { "$FB" login:list 2>/dev/null | grep -qi 'logged in as'; }
gcloud_signed_in() {
  [[ -n "$("$GC" auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null)" ]]
}
step_login() {
  if firebase_signed_in; then done_msg "Firebase CLI signed in"
  else log "Firebase sign-in: a browser tab opens; choose your Google account and allow."
    "$FB" login
  fi
  if gcloud_signed_in; then done_msg "Google Cloud CLI signed in"
  else log "Google Cloud sign-in: a browser tab opens; use the same account."
    "$GC" auth login --brief
  fi
}

# ---- project -------------------------------------------------------------
step_project() {
  local id="${FIREBASE_PROJECT_ID:-}"
  if [[ -n "$id" ]] && "$FB" projects:list --json 2>/dev/null \
      | jq -e --arg id "$id" '.result[] | select(.projectId == $id)' >/dev/null; then
    done_msg "project $id"; return
  fi
  local ids; ids="$("$FB" projects:list --json | jq -r '.result[].projectId')"
  if [[ -n "$ids" ]]; then
    echo "Your Firebase projects:" >&2
    printf '%s\n' "$ids" | sed 's/^/  /' >&2
  fi
  local suggested; suggested="context-lens-$(rand_hex 2)"
  local answer=""
  [[ "${ASSUME_YES:-0}" == 1 ]] || read -r -p "Project ID to use or create [$suggested]: " answer < /dev/tty
  id="${answer:-$suggested}"
  [[ "$id" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]] || die "not a valid project ID: $id"
  if printf '%s\n' "$ids" | grep -qx -- "$id"; then :
  elif "$GC" projects describe "$id" >/dev/null 2>&1; then
    log "adding Firebase to the existing Google Cloud project $id"
    "$FB" projects:addfirebase "$id"
  else
    log "creating Firebase project $id"
    "$FB" projects:create "$id" --display-name "ContextLens"
  fi
  env_set "$TL_ENV_FILE" FIREBASE_PROJECT_ID "$id"
  done_msg "project $id saved in .env"
}

# ---- apis ----------------------------------------------------------------
step_apis() {
  local p; p="$(project_id)"
  local enabled; enabled="$("$GC" services list --enabled --project "$p" --format='value(config.name)')"
  local missing=() a
  for a in "${APIS[@]}"; do printf '%s\n' "$enabled" | grep -qx "$a" || missing+=("$a"); done
  if [[ "${#missing[@]}" -gt 0 ]]; then
    log "enabling ${#missing[@]} API(s)"
    "$GC" services enable "${missing[@]}" --project "$p"
  fi
  done_msg "APIs enabled"
  if [[ "$(env_get "$TL_ENV_FILE" AI_LOGIC_READY)" != yes ]]; then
    log "AI Logic: click 'Get started' and choose the Gemini Developer API (no billing needed)."
    open_url "$CONSOLE/$p/ailogic"
    if [[ "${ASSUME_YES:-0}" == 1 ]]; then
      warn "AI Logic not confirmed (--yes); run ./dev cloud apis again after the console step"
      return 0
    fi
    pause "AI Logic set up?"
    env_set "$TL_ENV_FILE" AI_LOGIC_READY yes
  fi
  done_msg "AI Logic"
}

# ---- apps ----------------------------------------------------------------
# app_id <ANDROID|WEB> <displayName>: the app's ID, or nothing.
app_id() {
  local out
  project_id >/dev/null
  out="$(fb apps:list "$1" --json 2>/dev/null)" \
    || die "firebase apps:list failed (signed in? run ./dev cloud login)"
  printf '%s' "$out" | jq -r --arg n "$2" --arg pkg "$TL_PACKAGE" \
      '[.result[] | select(.displayName == $n or .packageName == $pkg)][0].appId // empty'
}

debug_sha() {
  local ks="$HOME/.android/debug.keystore"
  [[ -f "$ks" ]] || return 0
  keytool -list -v -keystore "$ks" -alias androiddebugkey -storepass android 2>/dev/null \
    | awk '/SHA256:/ {print $2; exit}' || true
}

step_android() {
  need keytool "part of the JDK"
  local id; id="$(app_id ANDROID ContextLens)"
  if [[ -z "$id" ]]; then
    log "registering the Android app $TL_PACKAGE"
    fb apps:create ANDROID ContextLens --package-name "$TL_PACKAGE" >/dev/null
    id="$(app_id ANDROID ContextLens)"
    [[ -n "$id" ]] || die "the Android app was not registered"
  fi
  env_set "$TL_ENV_FILE" FIREBASE_ANDROID_APP_ID "$id"
  done_msg "Android app registered"

  local have; have="$(fb apps:android:sha:list "$id" 2>/dev/null | tr '[:lower:]' '[:upper:]')"
  local sha shas=()
  sha="$(debug_sha)"
  if [[ -n "$sha" ]]; then shas+=("$sha"); else warn "no debug keystore yet (build once with ./dev build)"; fi
  local ks="${ANDROID_KEYSTORE_PATH:-}"
  if [[ -n "$ks" && -f "$ks" && -t 0 ]]; then
    log "release keystore: keytool asks for its password to read the fingerprint"
    sha="$(keytool -list -v -keystore "$ks" -alias "${ANDROID_KEY_ALIAS:-contextlens}" | awk '/SHA256:/ {print $2; exit}')"
    [[ -n "$sha" ]] && shas+=("$sha")
  fi
  for sha in ${shas[@]+"${shas[@]}"}; do
    if [[ "$have" == *"${sha//:/}"* || "$have" == *"$sha"* ]]; then continue; fi
    fb apps:android:sha:create "$id" "$sha" >/dev/null
  done
  done_msg "signing fingerprints (${#shas[@]})"
  write_google_services
}

write_google_services() {
  project_id >/dev/null
  local id; id="$(env_get "$TL_ENV_FILE" FIREBASE_ANDROID_APP_ID)"
  [[ -n "$id" ]] || die "no Android app yet: run ./dev cloud android"
  mkdir -p "$(dirname "$GSJ")"
  rm -f "$GSJ.tmp"
  fb apps:sdkconfig ANDROID "$id" --out "$GSJ.tmp" >/dev/null 2>&1 \
    || fb apps:sdkconfig ANDROID "$id" > "$GSJ.tmp"
  jq -e '.project_info' "$GSJ.tmp" >/dev/null || { rm -f "$GSJ.tmp"; die "unexpected google-services.json"; }
  mv "$GSJ.tmp" "$GSJ"; chmod 600 "$GSJ"
  done_msg "google-services.json written (git-ignored)"
}

step_web() {
  local id; id="$(app_id WEB "ContextLens web")"
  if [[ -z "$id" ]]; then
    log "registering the web app"
    fb apps:create WEB "ContextLens web" >/dev/null
    id="$(app_id WEB "ContextLens web")"
    [[ -n "$id" ]] || die "the web app was not registered"
  fi
  env_set "$TL_ENV_FILE" FIREBASE_WEB_APP_ID "$id"
  local cfg; cfg="$(api GET "$FM/projects/-/webApps/$id/config")"
  local pair key field value
  for pair in API_KEY:apiKey AUTH_DOMAIN:authDomain PROJECT_ID:projectId APP_ID:appId \
      MESSAGING_SENDER_ID:messagingSenderId; do
    key="VITE_FIREBASE_${pair%%:*}"; field="${pair#*:}"
    value="$(printf '%s' "$cfg" | jq -r --arg f "$field" '.[$f] // empty')"
    [[ -n "$value" ]] || die "web config has no $field"
    env_set "$TL_WEB_ENV" "$key" "$value"
  done
  done_msg "web app registered; apps/web/.env.local written (git-ignored)"
}

# ---- firestore -----------------------------------------------------------
step_firestore() {
  local p; p="$(project_id)"
  if "$GC" firestore databases describe --database='(default)' --project "$p" >/dev/null 2>&1; then
    done_msg "Firestore database"; return
  fi
  local loc="${FIRESTORE_LOCATION:-nam5}"
  log "creating the Firestore database in $loc (production mode; rules come from the repository)"
  "$GC" firestore databases create --database='(default)' --location="$loc" --project "$p" >/dev/null
  done_msg "Firestore database created"
}

# ---- auth ----------------------------------------------------------------
google_enabled() {
  api GET "$IT/projects/$(project_id)/defaultSupportedIdpConfigs/google.com" 2>/dev/null \
    | jq -e '.enabled == true' >/dev/null
}
step_auth() {
  local p; p="$(project_id)"
  gcloud_signed_in || die "gcloud is not signed in: run ./dev cloud login"
  if ! api GET "$IT/projects/$p/config" >/dev/null 2>&1 || ! google_enabled; then
    log "Authentication: click 'Get started' if asked, then Sign-in method → Google → Enable → Save."
    log "(Google creates the OAuth client for this provider; there is no API for that step.)"
    open_url "$CONSOLE/$p/authentication/providers"
    pause "Google sign-in enabled?"
    google_enabled || die "Google sign-in is not enabled yet; run ./dev cloud auth again"
  fi
  done_msg "Google sign-in"
  api PATCH "$IT/projects/$p/config?updateMask=signIn.anonymous.enabled" \
    '{"signIn":{"anonymous":{"enabled":true}}}' >/dev/null
  done_msg "anonymous sign-in"
  local domain; domain="$(pages_domain)"
  local domains; domains="$(api GET "$IT/projects/$p/config" | jq -c '.authorizedDomains // []')"
  if ! printf '%s' "$domains" | jq -e --arg d "$domain" 'index($d)' >/dev/null; then
    local body; body="$(printf '%s' "$domains" | jq -c --arg d "$domain" '{authorizedDomains: (. + [$d])}')"
    api PATCH "$IT/projects/$p/config?updateMask=authorizedDomains" "$body" >/dev/null
  fi
  done_msg "authorized domain $domain"
}

# ---- recaptcha -----------------------------------------------------------
step_recaptcha() {
  local p; p="$(project_id)"
  local key; key="$(env_get "$TL_WEB_ENV" VITE_RECAPTCHA_SITE_KEY)"
  if [[ -z "$key" ]]; then
    key="$({ "$GC" recaptcha keys list --project "$p" --format=json 2>/dev/null || echo '[]'; } \
      | jq -r '[.[] | select(.displayName == "ContextLens web")][0].name // empty' | sed 's#.*/##')"
  fi
  if [[ -z "$key" ]]; then
    local domain; domain="$(pages_domain)"
    log "creating a reCAPTCHA Enterprise key for $domain and localhost"
    key="$("$GC" recaptcha keys create --display-name="ContextLens web" --web \
      --domains="$domain,localhost" --integration-type=score --project "$p" \
      --format='value(name)' | sed 's#.*/##')"
    [[ -n "$key" ]] || die "no reCAPTCHA key was created"
  fi
  env_set "$TL_WEB_ENV" VITE_RECAPTCHA_SITE_KEY "$key"
  done_msg "reCAPTCHA Enterprise key"
}

# ---- appcheck ------------------------------------------------------------
step_appcheck() {
  local p; p="$(project_id)"
  local android web key
  android="$(env_get "$TL_ENV_FILE" FIREBASE_ANDROID_APP_ID)"
  web="$(env_get "$TL_ENV_FILE" FIREBASE_WEB_APP_ID)"
  key="$(env_get "$TL_WEB_ENV" VITE_RECAPTCHA_SITE_KEY)"
  [[ -n "$android" && -n "$web" && -n "$key" ]] || die "run the android, web and recaptcha steps first"
  api PATCH "$AC/projects/$p/apps/$android/playIntegrityConfig?updateMask=tokenTtl" \
    '{"tokenTtl":"3600s"}' >/dev/null
  done_msg "App Check: Play Integrity for Android (debug builds use a debug token: ./dev phone token)"
  api PATCH "$AC/projects/$p/apps/$web/recaptchaEnterpriseConfig?updateMask=siteKey,tokenTtl" \
    "$(jq -nc --arg k "$key" '{siteKey: $k, tokenTtl: "3600s"}')" >/dev/null
  done_msg "App Check: reCAPTCHA Enterprise for the web app"
  if [[ "$enforce" -eq 1 ]]; then
    api PATCH "$AC/projects/$p/services/firebasevertexai.googleapis.com?updateMask=enforcementMode" \
      '{"enforcementMode":"ENFORCED"}' >/dev/null
    done_msg "App Check enforced on AI Logic"
  else
    log "App Check is registered but not enforced; review the metrics, then: ./dev cloud appcheck --enforce"
  fi
}

# ---- github --------------------------------------------------------------
step_github() {
  local repo; repo="$(github_repo)"
  [[ -f "$GSJ" ]] || die "no google-services.json: run ./dev cloud android"
  confirm "Write the Firebase configuration to the Actions variables and secrets of $repo?" \
    || { log "skipped"; return 0; }
  local gh; gh="$(gh_bin)"
  local name value
  for name in VITE_FIREBASE_API_KEY VITE_FIREBASE_AUTH_DOMAIN VITE_FIREBASE_PROJECT_ID \
      VITE_FIREBASE_APP_ID VITE_FIREBASE_MESSAGING_SENDER_ID VITE_RECAPTCHA_SITE_KEY; do
    value="$(env_get "$TL_WEB_ENV" "$name")"
    [[ -n "$value" ]] || die "$name is missing: run ./dev cloud web and recaptcha"
    printf '%s' "$value" | "$gh" variable set "$name" --repo "$repo" >/dev/null
  done
  printf '%s' "$(project_id)" | "$gh" variable set FIREBASE_PROJECT_ID --repo "$repo" >/dev/null
  base64 -w0 "$GSJ" | "$gh" secret set GOOGLE_SERVICES_JSON_B64 --repo "$repo" >/dev/null
  env_get "$TL_ENV_FILE" FIREBASE_ANDROID_APP_ID | tr -d '\n' \
    | "$gh" secret set FIREBASE_ANDROID_APP_ID --repo "$repo" >/dev/null
  done_msg "GitHub: 7 variables and 2 secrets set on $repo (the next Pages deploy picks them up)"
}

# ---- status --------------------------------------------------------------
# check <label> <hint> <command...>: one status line.
check() {
  local label="$1" hint="$2"; shift 2
  if "$@" >/dev/null 2>&1; then printf '  %-8s %s\n' ok "$label"
  else printf '  %-8s %s\n' todo "$label${hint:+ ($hint)}"; fi
}
env_has() { [[ -n "$(env_get "$1" "$2")" ]]; }
step_status() {
  check "Firebase CLI" "./dev cloud tools" has "$FB"
  check "Google Cloud CLI" "./dev cloud tools" has "$GC"
  check "Firebase sign-in" "./dev cloud login" firebase_signed_in
  check "Google Cloud sign-in" "./dev cloud login" gcloud_signed_in
  check FIREBASE_PROJECT_ID "./dev cloud project" env_has "$TL_ENV_FILE" FIREBASE_PROJECT_ID
  check "AI Logic" "./dev cloud apis" env_has "$TL_ENV_FILE" AI_LOGIC_READY
  check "Android app" "./dev cloud android" env_has "$TL_ENV_FILE" FIREBASE_ANDROID_APP_ID
  check google-services.json "./dev cloud android" test -f "$GSJ"
  check "web app" "./dev cloud web" env_has "$TL_WEB_ENV" VITE_FIREBASE_API_KEY
  check "reCAPTCHA key" "./dev cloud recaptcha" env_has "$TL_WEB_ENV" VITE_RECAPTCHA_SITE_KEY
}

case "$step" in
  all)
    step_tools; step_login; step_project; step_apis; step_android; step_web
    step_firestore; step_auth; step_recaptcha; step_appcheck
    write_google_services   # again, now with the OAuth client from the Google provider
    step_github
    log "backend ready; next: ./dev phone pair (or plug in USB), then ./dev phone prep and ./dev phone token" ;;
  tools|login|project|apis|android|web|firestore|auth|recaptcha|appcheck|github|status) "step_$step" ;;
  *) die "unknown step: $step (try --help)" 2 ;;
esac

# Web companion setup

The web companion is published at the root of this site; these docs live under `/docs/`. It builds without any configuration: it then shows the Android download and these docs only. To run the live demo against your own Firebase project:

## Firebase

`./dev cloud` does all of this from a terminal, apart from two console clicks; see [Setup](setup.md). By hand:

1. In the Firebase console, open the project and **Add app → Web**. Copy the config values.
2. **Authentication → Settings → Authorized domains**: add the domain that serves the app (for this repository, `nikolareljin.github.io`; `localhost` is there by default).
3. **App Check → Apps → the web app → reCAPTCHA Enterprise**: create a score-based key for the same domain and register it. For local development, run the app once, copy the App Check debug token from the browser console and add it under **Manage debug tokens**.
4. **AI Logic** must be enabled for the project (Gemini Developer API), as for the Android app.

## Build configuration

The values go into repository **variables** (not secrets; web config is public once deployed, but it stays out of the repository so forks build an unconfigured app):

| Variable | From |
|---|---|
| `VITE_FIREBASE_API_KEY` | web app config `apiKey` |
| `VITE_FIREBASE_AUTH_DOMAIN` | `authDomain` |
| `VITE_FIREBASE_PROJECT_ID` | `projectId` |
| `VITE_FIREBASE_APP_ID` | `appId` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | `messagingSenderId` |
| `VITE_RECAPTCHA_SITE_KEY` | the reCAPTCHA Enterprise site key |

For a local build, put the same names in `apps/web/.env.local` (git-ignored).

## Gemini Nano in Chrome

On-device inference in the browser needs Chrome on desktop, version 139 or newer, with the built-in model available:

1. `chrome://flags/#optimization-guide-on-device-model`: **Enabled**.
2. `chrome://flags/#prompt-api-for-gemini-nano`: **Enabled** (and `#prompt-api-for-gemini-nano-multimodal-input` for audio).
3. Restart Chrome; `chrome://on-device-internals` shows the model state. The app starts the download after a click, as Chrome requires.

Without the model, Balanced mode uses cloud Gemini and says so; Strict mode filters with local rules only.

## Local commands

```bash
./dev web check   # install, type check, tests, build
./dev web dev     # http://127.0.0.1:5173/context-lens/
```

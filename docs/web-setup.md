# Web companion setup

The web companion is published at the root of this site; these docs live under `/docs/`. The site carries no Firebase project and no key: out of the box it runs in the browser alone, and the grounded cloud check runs only in a Firebase project that you connect on the page.

## What runs without a project

- The local rules drop small talk; nothing is called for it.
- The gatekeeper runs on Chrome's built-in Gemini Nano (Firebase AI Logic, `ONLY_ON_DEVICE`), when Chrome has it. Without it, the card says the model isn't available and only the local rules ran.
- The cloud step shows **Not checked in the cloud: no Firebase project is connected** with a link that searches the clean question in your own browser.
- No request goes to Google or Firebase: the ledger stays empty. The page loads the Firebase SDK code from this site only when the on-device model is first used, and the SDK's local app names no project and holds no key.

The microphone stays off: Chrome's speech recognition sends audio to Google.

## Connect your Firebase project

1. In the Firebase console, open your project and **Add app → Web**. Copy the `firebaseConfig` it shows.
2. **AI Logic** must be enabled for the project (Gemini Developer API), as for the Android app.
3. **Authentication → Settings → Authorized domains**: add the domain that serves the page (`localhost` is there by default). Only needed for anonymous sign-in.
4. On the page, under **Cloud check: your Firebase project**, paste the config (the JavaScript snippet or the same values as JSON) or a web connect code, and choose **Connect…**. The page names the project and connects only after you confirm.

A web connect code carries the same values on one line:

```text
contextlens-web-connect:1?project=demo-springfield&app=1%3A5550001%3Aweb%3A5ca1ab1e&key=<apiKey>&domain=demo-springfield.firebaseapp.com&sender=5550001
```

`site=<reCAPTCHA site key>` is optional. Each value is checked: `apiKey` must look like a web API key, `appId` like `1:<number>:web:<hex>`, the project id like a Firebase project id, and `messagingSenderId` must match the app id's project number.

The values go only to Firebase, through the SDK. By default they are kept in the tab's memory only and are gone when the tab closes. Tick **Remember on this device** before connecting to keep them in this browser's local storage instead; all sites under `nikolareljin.github.io` share that storage (same origin), so remember a project only in a personal browser. **Disconnect** clears both, and connecting another project starts a fresh Firebase app instance. Clean questions then run on your project's quota and bill.

Without remembering, the page writes nothing of the project to local storage, session storage or IndexedDB: the Firebase SDK's daily usage record is turned off and an anonymous sign-in is kept in memory. Only App Check, when you give it a site key, keeps its short-lived token in IndexedDB, as the SDK does; Disconnect deletes it.

### Restrict the API key

A web API key is visible to anyone who has the config. Before giving a key to judges or testers, restrict it in the Google Cloud console (**APIs & Services → Credentials → the key → Application restrictions → Websites**) to the page's address, path included: `https://nikolareljin.github.io/context-lens/*` (add `http://localhost:5173/*` for local development). Other sites under the same domain then cannot use it.

### Optional: App Check and anonymous sign-in

- **App Check**: add `"recaptchaSiteKey": "<site key>"` to the pasted config (or `site=` to the code) and the page turns on App Check with the reCAPTCHA Enterprise provider. Create a score-based key for your domain under **App Check → Apps → the web app → reCAPTCHA Enterprise**. For local development, add the App Check debug token from the browser console under **Manage debug tokens**. Without a site key App Check stays off, which works while it is not enforced.
- **Anonymous sign-in**: tick the box before connecting (needs `authDomain` and the Anonymous provider enabled).

Both are set up right before the first cloud call, and each is listed in the ledger.

## Privacy modes

- **Strict** (default): the gatekeeper runs only on Chrome's model. A reply from anywhere else is recorded in the ledger and not used.
- **Balanced** (only with a project connected): Firebase AI Logic prefers the on-device model and falls back to cloud Gemini; every call that may have gone to the cloud is in the ledger, word for word.

## Gemini Nano in Chrome

On-device inference in the browser needs Chrome on desktop, version 139 or newer, with the built-in model available:

1. `chrome://flags/#optimization-guide-on-device-model`: **Enabled**.
2. `chrome://flags/#prompt-api-for-gemini-nano`: **Enabled** (and `#prompt-api-for-gemini-nano-multimodal-input` for audio).
3. Restart Chrome; `chrome://on-device-internals` shows the model state. When Chrome can download the model, the page offers **Download Gemini Nano**: Chrome requires a click before it starts, and fetches the model itself.

## No build configuration

The site is built without any Firebase values, and `apps/web` reads none: there is no `VITE_FIREBASE_*` setting, and a local `apps/web/.env.local` is never built in. CI fails the web build and the Pages deploy if the built output contains a Firebase API key, a Firebase app id or a `*.firebaseapp.com` / `*.web.app` host (`scripts/site-leak-check.sh`).

## Local commands

```bash
./dev web check   # install, type check, tests, build
./dev web dev     # http://127.0.0.1:5173/context-lens/
bash scripts/site-leak-check.sh apps/web/dist
```

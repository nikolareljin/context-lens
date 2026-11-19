# Setup

## Toolchain

JDK 17, Android SDK (platform 35 or newer), Git and Bash (Node 22 only for the Firebase CLI). Check with:

```bash
./dev setup --check
```

## Firebase backend, scripted

Run this in a terminal; it asks questions and opens browser pages:

```bash
./dev cloud          # every step; run it again any time, finished steps are skipped
./dev cloud status   # what is done and what is left
```

| Step | What happens |
|---|---|
| `tools` | Installs the Firebase CLI (standalone binary) into `~/.local/bin` and the Google Cloud CLI into `~/google-cloud-sdk`, after asking. |
| `login` | Signs in to both with your Google account in the browser. This is the only sign-in. |
| `project` | Creates or picks the Firebase project and saves its ID as `FIREBASE_PROJECT_ID` in `.env`. |
| `apis` | Enables the APIs (AI Logic, Gemini, App Check, reCAPTCHA Enterprise, Firestore, Remote Config, Identity Toolkit, Play Integrity). Opens **AI Logic** so you can click *Get started* → *Gemini Developer API*. |
| `android` | Registers `com.contextlens.app`, adds the debug and release SHA-256 fingerprints, writes `apps/android/app/google-services.json`. |
| `web` | Registers the web app and keeps its configuration in `apps/web/.env.local` for your reference. The site never reads it: paste the config into the page to connect (see [Web companion setup](web-setup.md)). |
| `firestore` | Creates the Firestore database (`FIRESTORE_LOCATION`, default `nam5`). |
| `auth` | Opens **Authentication** so you can enable Google sign-in: Google creates that provider's OAuth client, and there is no API for it. Then turns on anonymous sign-in and adds `<owner>.github.io` to the authorized domains. |
| `recaptcha` | Creates a score-based reCAPTCHA Enterprise key for `<owner>.github.io` and `localhost`. |
| `appcheck` | Registers Play Integrity (Android) and reCAPTCHA Enterprise (web). `--enforce` also enforces App Check on AI Logic. |
| `github` | Sets the App Distribution target (project ID and Android app ID) as masked repository secrets, never plain variables, so neither can appear in Actions logs; a leftover `FIREBASE_PROJECT_ID` variable from an older setup is deleted. It stops before writing anything if either value is missing. The Firebase configuration never goes to GitHub: public builds carry none. |

The configuration goes to git-ignored files; GitHub gets only the App Distribution target. None of it is printed.

Two steps stay in the console because they have no API: starting AI Logic, and enabling the Google provider. The script opens the exact page and waits for you.

!!! note "App Check and sideloaded APKs"
    Play Integrity only vouches for installs from Google Play. A release APK installed from the QR code or with `./dev phone-install` fails it. Keep App Check registered but not enforced while the APK is shared that way.

## Phone, scripted

```bash
./dev phone          # pair over Wi-Fi by QR code (if no phone is connected), check it, register its token
./dev phone pair     # Developer options → Wireless debugging → Pair device with QR code
./dev phone usb      # or: USB debugging with a cable
./dev phone prep     # Android version, Google account (opens "Add account" on the phone), AICore
./dev phone token    # register the debug build's App Check token from the phone log
```

## Firebase backend, by hand

1. Create a Firebase project and enable **Firebase AI Logic** with the Gemini Developer API.
2. Register the Android app `com.contextlens.app` and add the SHA-256 fingerprints of the debug and release keys.
3. Download `google-services.json` into `apps/android/app/` (the file is git-ignored).
4. Enable **App Check**. Release builds use Play Integrity. Debug builds use the debug provider: run the app once, copy the debug token from logcat and register it under App Check → Manage debug tokens.
5. Enable **Authentication** → **Anonymous**.
6. Remote Config: the defaults are compiled into the app; a template for the console is added with the Remote Config milestone.

## Build, test, install

```bash
./dev build      # debug APK
./dev test       # unit and script tests
./dev lint       # Android lint and shellcheck
./dev install    # install on a connected phone and launch
./dev docs serve # this site, locally
```

## Release signing

```bash
./dev keystore   # creates the release keystore outside the repository
```

Set `ANDROID_KEYSTORE_PATH` and `ANDROID_KEY_ALIAS` in `.env`, and the two passwords in the environment, then `./dev apk release`.

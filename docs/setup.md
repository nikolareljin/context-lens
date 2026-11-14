# Setup

## Toolchain

JDK 17, Android SDK (platform 35 or newer), Git and Bash (Node 22 only for the Firebase CLI). Check with:

```bash
./dev setup --check
```

## Firebase

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

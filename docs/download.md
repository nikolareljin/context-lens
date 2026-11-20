# Download

Every release on GitHub carries a signed APK. One fixed address always serves the newest one:
`https://github.com/nikolareljin/context-lens/releases/latest/download/context-lens.apk`.

## Scan with the phone

<div class="cl-qr" markdown>
<img src="../assets/apk-qr.svg" alt="QR code that downloads the newest ContextLens APK">
<div markdown>
1. Point the phone's camera at the code and open the link. The newest APK downloads.
2. Open the download. ContextLens is not on Google Play, so Android asks to **allow installs from this source** (the browser or file manager); allow it.
3. If Play Protect warns, choose **More details**, then **Install anyway**.
4. Open ContextLens.
</div>
</div>

[Latest release](https://github.com/nikolareljin/context-lens/releases/latest){ .md-button .md-button--primary } [All releases](https://github.com/nikolareljin/context-lens/releases){ .md-button }

## Install over USB from a computer

With **USB debugging** on (Settings → About phone → tap **Build number** seven times, then Settings → System → **Developer options** → **USB debugging**), connect the phone and run, from a clone of the repository:

```bash
bash scripts/phone-install.sh                  # the newest release
bash scripts/phone-install.sh --version 0.2.0  # a given release
bash scripts/phone-install.sh --apk my.apk     # a file you already have
```

The script finds `adb`, or downloads Google's platform-tools (about 10 MB) into `~/.context-lens/`. It downloads the APK, waits for the phone (accept the **Allow USB debugging** prompt), installs over any older copy and opens the app. It runs on Linux, macOS and WSL and needs no JDK or Android SDK.

## Requirements

Android 8.0 (API 26) or newer. The on-device gatekeeper needs a phone with Gemini Nano support (for example recent Pixel and Galaxy flagships). On other phones Strict mode filters with local rules only, and Balanced mode can use the cloud.

## Updates

Every release is signed with the same key, so a newer APK installs over an older one and keeps the app's settings. A debug APK from a CI run is signed with a different key: uninstall it before installing a release.

## What works without setup

The phone side needs no account and no network: speech, the local rules, Gemini Nano writing the clean question, the personal-data check and the ledger. Released APKs carry no Firebase project, so nobody uses the maintainer's backend. The grounded cloud check needs a Firebase project of your own: [connect it in Settings](own-project.md). Without one, or when the phone is offline, each card offers a search of its clean question in the browser instead, and nothing is sent.

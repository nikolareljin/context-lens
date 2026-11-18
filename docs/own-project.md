# Connect your own Firebase project

ContextLens has no server and no shared backend. Out of the box the app works on the phone alone: speech, the local rules, Gemini Nano writing the clean question, the personal-data check and the ledger. Nothing leaves the phone, and each card offers a browser search of its clean question.

The grounded check (cloud Gemini with Google Search) runs through Firebase AI Logic in **your own** Firebase project, on your quota and your bill. These steps take about 15 minutes in a browser.

## 1. Create the project

1. Open the [Firebase console](https://console.firebase.google.com/) and choose **Create a project**. Any name works; Google Analytics is not needed.
2. **Upgrade to Blaze** (Usage and billing). Grounding with Google Search is not part of the Gemini free tier, so the check is refused on a project without billing.
3. Keep costs bounded before you use it:
    - In [Google AI Studio](https://aistudio.google.com/), import the project and buy prepaid credit (the minimum is enough for many checks); leave auto-reload off. When the credit runs out, Gemini calls stop instead of charging more.
    - Set a monthly spend cap there and a budget alert in the Cloud console billing page.
    - One check is a short question and a short answer on a Flash-Lite model, plus one or two searches. See Google's [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing) for current prices and the free search allowance.

## 2. Turn on what the app uses

1. **AI Logic**: Build → AI Logic → **Get started**, and choose the **Gemini Developer API**.
2. **Authentication**: Build → Authentication → Sign-in method → enable **Anonymous**. The app signs each install in anonymously; it asks for no name or email.

## 3. Add the Android app

1. Project settings → **Add app** → Android.
2. Package name: `com.contextlens.app`.
3. Download **google-services.json** to the phone (or keep it on your computer to copy three values from it).

## 4. Restrict the API key (recommended)

In the [Cloud console credentials page](https://console.cloud.google.com/apis/credentials) for your project, open the Android key Firebase created and add an **Android apps** restriction:

| Package | SHA-1 certificate fingerprint |
|---|---|
| `com.contextlens.app` | `F5:67:C2:A1:E2:BB:85:BD:D8:FA:38:90:A2:76:30:69:90:5A:48:87` (release APKs) |

The key then answers only the released ContextLens app. A key restriction can be imitated by a determined client, so the prepaid limit and the spend cap above are what bound your costs.

**App Check** is optional. If you enforce it for AI Logic, register the app with Play Integrity and the release SHA-256 fingerprint `B4:88:A9:35:D4:99:E8:ED:02:10:89:0E:79:A2:D6:49:B1:5D:3C:01:08:7B:53:A6:81:E7:89:67:D2:2A:2D:8D`; otherwise leave it unenforced.

## 5. Connect it in the app

1. In ContextLens, open **Settings**.
2. Tap **Import google-services.json** and pick the file, or type the three values from it:
    - **Project ID**: `project_info.project_id`
    - **App ID**: `client_info.mobilesdk_app_id` of the `com.contextlens.app` client (`1:…:android:…`)
    - **API key**: `api_key[0].current_key` of that client (`AIza…`)
3. Tap **Save and restart**. The values stay on the phone, in the app's private storage, and are not backed up or copied to a new phone.
4. Check it: Diagnostics → **Test in cloud**. The call log shows the model that answered.

**Disconnect and restart** in Settings removes the values; the app is then phone-only again.

### Or connect with a connect code

To let testers use your project without setting one up, make a connect code on your computer:

```bash
scripts/connect-qr.sh path/to/google-services.json   # writes ~/.config/context-lens/connect-qr.png and connect-code.txt
```

The tester opens ContextLens → Settings and taps **Scan connect code** (Google's code scanner; the app needs no camera permission) or copies the text code and taps **Paste connect code**. The app names the project and connects only after **Connect and restart**. Nothing goes through a browser. Scanning is the better choice: after a paste the app clears the clipboard, but a keyboard's clipboard history or clipboard sync may keep its own copy, which the tester can delete there.

The code carries your API key. Share it only privately, and delete or rotate that key when testing ends. The script refuses to write it into a git checkout.

## What goes to your project

- The anonymous sign-in of the install and App Check tokens, with no name, email or speech.
- What the [privacy firewall](privacy.md) lets out: the clean question for each checkable claim, and in Balanced mode the sentence when the phone can't run the model. The Ledger lists each of these requests word for word.

Crash reports are never sent to a connected project.

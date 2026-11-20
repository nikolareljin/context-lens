# Chrome extension

The extension puts the [web companion](../)'s live demo in Chrome's side panel, next to whatever you are reading or watching. It runs the same three stages: the local rules and Gemini Nano in Chrome on your computer, and the grounded check in a Firebase project you connect. It reads nothing from the pages you visit: you type or paste the sentence.

You need Chrome 138 or newer on Windows, macOS or Linux; Chromium and Chrome for Testing work too. (Microsoft Edge and Brave can load it the same way from their extensions page, but they have no Gemini Nano, so only the local rules and the cloud check run there.) Gemini Nano is optional: without it the local rules still run, and with a project connected, Balanced mode checks in the cloud. Getting Gemini Nano is described in [Web companion setup](web-setup.md).

## Install with one command

Copy the command for your system into a terminal and press Enter.

=== "Linux, macOS"

    ```bash
    curl -fsSL https://raw.githubusercontent.com/nikolareljin/context-lens/main/scripts/extension-install.sh | bash
    ```

=== "Windows (PowerShell)"

    ```powershell
    irm https://raw.githubusercontent.com/nikolareljin/context-lens/main/scripts/extension-install.ps1 | iex
    ```

What the command does:

1. Downloads the extension from the newest [release](https://github.com/nikolareljin/context-lens/releases/latest), checks it against its published SHA-256 checksum, and unpacks it into a `context-lens/extension` folder in your home folder.
2. **If Chromium or Chrome for Testing is installed**, it starts that browser with ContextLens already loaded and opens it in a tab. It uses its own profile (`context-lens/browser-profile`), so your usual profile, bookmarks and sign-ins are left alone. You are done; go to [Check that it works](#check-that-it-works).
3. **Otherwise** it copies the folder path to the clipboard, opens `chrome://extensions` in Chrome and prints the four clicks below. Google Chrome does not let a command load an extension any more, so these clicks are needed once.

On WSL, use the PowerShell command in Windows, so that Chrome on Windows can read the folder.

## Load it in Chrome (four clicks)

In `chrome://extensions` (type it in the address bar if it did not open):

1. Turn on **Developer mode**, the switch in the top-right corner.
2. Click **Load unpacked**, top left.
3. Choose the `context-lens/extension` folder in your home folder and click **Select** (or **Select Folder**). The command already copied its path: in the folder window press ++ctrl+l++ (Linux), click the folder bar (Windows) or press ++cmd+shift+g++ (Mac), paste, and press Enter.
4. Click the puzzle icon next to the address bar and pin **ContextLens**.

## Install without a terminal

1. Download `context-lens-extension.zip` from the [newest release](https://github.com/nikolareljin/context-lens/releases/latest).
2. Unzip it into a folder you will keep, for example `context-lens/extension` in your home folder. (If Chrome is reading the extension from a folder that you delete, it stops working.)
3. Follow [Load it in Chrome](#load-it-in-chrome-four-clicks), choosing that folder in step 3.

To check the download first, compare its SHA-256 with `context-lens-extension.zip.sha256` from the same release (`sha256sum`, `shasum -a 256` or `Get-FileHash`).

## Check that it works

1. Click the ContextLens icon in the toolbar. The side panel opens with **Try it in Chrome**.
2. Click **Run demo**. Cards appear for the demo sentences: small talk is dropped by the local rules, and claims show each stage with where it ran.
3. Without a connected project the cloud step says **no Firebase project is connected** and offers a search link instead, and the egress ledger stays empty: nothing left your computer.

## Connect a Firebase project

The grounded check runs in a Firebase project you connect, on that project's quota and bill. In the side panel, under **Cloud check: your Firebase project**, paste the web app's config or a web connect code, choose **Connect…** and confirm the project name. [Web companion setup](web-setup.md) explains how to get either from a project of your own.

- **Given a connect code?** Paste it as it is. Tick **Remember on this device** to keep it after the panel closes.
- The extension keeps a remembered project in its own storage, separate from every website.
- App Check's reCAPTCHA can't run inside an extension, so a config with a reCAPTCHA site key is refused; the project must not enforce App Check for Firebase AI Logic.
- Extension pages send no referrer, so an API key restricted to **websites** is refused in the extension. Use a key restricted by API instead (**API restrictions**: Firebase AI Logic API, plus Identity Toolkit API for anonymous sign-in), for example a second key used only in the extension's connect code; see [Restrict the API key](web-setup.md#restrict-the-api-key).

## Update

Run the same install command again. In Chromium or Chrome for Testing, restart the browser it started. In Chrome, open `chrome://extensions` and click the reload arrow on the ContextLens card. Your connected project stays.

## Remove

Open `chrome://extensions` and click **Remove** on the ContextLens card, then delete the `context-lens` folder in your home folder. Removing the extension deletes everything it stored.

## Why Developer mode?

Chrome installs extensions with one click only from the Chrome Web Store. ContextLens is not there yet, so Chrome loads it from a folder, which needs Developer mode. You can turn Developer mode off again; Chrome then shows a reminder at startup that an unpacked extension is loaded.

## What it can access

The extension asks for one permission: the side panel. It has no access to the pages you visit, your tabs, history or downloads, and no content scripts. All its code is in the package (extensions can't run code from the web), and the package contains no App Check or sign-in popup code, which would load scripts from Google. Requests go only to Chrome's on-device model and, with a project connected, to Firebase for that project; the egress ledger lists every one of them, word for word.

## What it is for

A fact check next to what you are reading or watching, without sending your notes or the conversation anywhere:

- **Captions of a video or meeting:** paste the sentence someone just said ("revenue doubled since last year") and get a grounded card while the video keeps playing.
- **Articles and posts:** check a claim before you share or quote it.
- **Your own notes and drafts:** check a figure or a date before you send them; names, numbers and places are kept out of the question that goes to the cloud.

Built now: typing or pasting a sentence in the side panel. Next: checking selected text from the right-click menu, and live captions on the device.

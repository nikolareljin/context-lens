// Fixed addresses of the published site. The site carries no Firebase configuration: the live
// demo runs only on a project the visitor connects in their own browser (see cloud/project.ts).

export const RELEASES = "https://github.com/nikolareljin/context-lens/releases";
export const LATEST_APK = `${RELEASES}/latest/download/context-lens.apk`;
export const REPOSITORY = "https://github.com/nikolareljin/context-lens";
export const SITE = "https://nikolareljin.github.io/context-lens/";

/** True in the Chrome extension build (`vite build --mode extension`), false on the site and in tests. */
export function inExtension(): boolean {
  return import.meta.env.MODE === "extension";
}

// The extension's pages live on their own chrome-extension:// origin, so its docs links are absolute.
export const DOCS = inExtension() ? `${SITE}docs/` : "/context-lens/docs/";

/** Why the extension refuses a reCAPTCHA site key: extension pages run no remote scripts. */
export const EXTENSION_APP_CHECK =
  "App Check's reCAPTCHA script can't load inside the extension (extensions run no remote code). Connect without the site key; Firebase AI Logic in that project must not enforce App Check.";

// The Chrome extension's three ways in (docs/extension.md "Choose how to install").
export const EXTENSION_ZIP = `${RELEASES}/latest/download/context-lens-extension.zip`;
const RAW_SCRIPTS = "https://raw.githubusercontent.com/nikolareljin/context-lens/main/scripts";
export const INSTALL_COMMANDS = {
  unix: `curl -fsSL ${RAW_SCRIPTS}/extension-install.sh | bash`,
  windows: `irm ${RAW_SCRIPTS}/extension-install.ps1 | iex`,
} as const;
/** The Chrome Web Store listing; null until Google publishes it, and the page then hides the button. */
export const WEB_STORE_URL: string | null = null;
/** The recorded run (a video of a real session); null until it exists, and the page then hides it. */
export const RECORDED_RUN_URL: string | null = null;

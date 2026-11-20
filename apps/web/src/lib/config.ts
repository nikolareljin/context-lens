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

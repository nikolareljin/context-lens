// The Chrome extension's manifest, written into the extension build (vite.config.ts) with the
// repository's version. One version for the whole repository: it comes from the VERSION file.

/**
 * Public half of the extension's signing key. It fixes the extension id, so an unpacked install,
 * a reinstall and every user share one chrome-extension:// origin. A public key, not a secret.
 */
export const EXTENSION_PUBLIC_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAsfh9KFyuAP9URxBNiT/8g7iA1FitXpo5s5xZLcNYdGZ5rupkpq5JTPEUWbJw1dsnedr3imlmKY/tEvHoW9p25NsQj7PfSFdIxIBpPlJ1Z7zQ1WvmHPjOnhSQOR/nOUjDnK/B9gF8eJFJyT6Aj8oN+FAEuzAXENIkC06+A3J8cFghJTLA1g1xgqFhTi4F579LNQEiQg7uMBG2Th/3D5UXiko+f9ZNmMkJ7AhcJlNpyzwc3UtKP48ORP4+JB80CLeiWv8FOrht/L3lBSLODrAX2NFaZzJfmcouGGZ3m9TgjTiQPYpGEM07uB90mvt5yqYkHfL8ZWeJ8TDuxDqMCgE56wIDAQAB";

/** The id Chrome derives from EXTENSION_PUBLIC_KEY (first 128 bits of its SHA-256, as a-p). */
export const EXTENSION_ID = "ibebpiolnohegpeabdgikjjnolphpbcd";

/** Chrome's built-in Gemini Nano (Prompt API) for extensions; older Chromes get the local rules only. */
export const MINIMUM_CHROME = "138";

export function buildManifest(version: string): Record<string, unknown> {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error(`not a release version: ${JSON.stringify(version)}`);
  }
  const icons = { "16": "icons/icon-16.png", "32": "icons/icon-32.png", "48": "icons/icon-48.png", "128": "icons/icon-128.png" };
  return {
    manifest_version: 3,
    name: "ContextLens",
    version,
    description:
      "Private, grounded fact checks: Gemini Nano in Chrome decides what is checked; your own Firebase project verifies it with Google Search.",
    minimum_chrome_version: MINIMUM_CHROME,
    key: EXTENSION_PUBLIC_KEY,
    icons,
    action: { default_title: "Open ContextLens", default_icon: icons },
    side_panel: { default_path: "sidepanel.html" },
    background: { service_worker: "background.js", type: "module" },
    // Only the side panel. No host permissions, no content scripts, no tabs or storage APIs:
    // the panel reads nothing from the pages you visit, and Firebase is reached through CORS.
    permissions: ["sidePanel"],
  };
}

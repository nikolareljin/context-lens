import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { buildManifest } from "./src/extension/manifest";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

// The extension build gets its manifest (with the repository's VERSION) and icons.
function extensionFiles(): Plugin {
  return {
    name: "context-lens-extension-files",
    apply: "build",
    writeBundle(options) {
      const out = options.dir!;
      const version = readFileSync(here("../../VERSION"), "utf8").trim();
      mkdirSync(`${out}/icons`, { recursive: true });
      for (const size of [16, 32, 48, 128]) copyFileSync(here(`extension/icons/icon-${size}.png`), `${out}/icons/icon-${size}.png`);
      writeJson(`${out}/manifest.json`, buildManifest(version));
    },
  };
}

// Served from GitHub Pages at https://nikolareljin.github.io/context-lens/ (docs under /context-lens/docs/).
// `vite build --mode extension` builds the Chrome extension instead: the same demo in a side panel.
export default defineConfig(({ mode }) => ({
  base: mode === "extension" ? "./" : "/context-lens/",
  plugins: [react(), tailwindcss(), ...(mode === "extension" ? [extensionFiles()] : [])],
  // The extension carries no code that loads scripts from Google: no App Check (reCAPTCHA), and
  // Firebase Auth's web-extension build (no popup, redirect or phone sign-in loaders).
  resolve:
    mode === "extension"
      ? {
          alias: {
            "@firebase/app-check": here("src/extension/noAppCheck.ts"),
            "@firebase/auth": here("node_modules/@firebase/auth/dist/web-extension-esm/index.js"),
          },
        }
      : {},
  // the site's public files (search-console verification) are not part of the extension
  publicDir: mode === "extension" ? false : "public",
  build:
    mode === "extension"
      ? {
          outDir: "dist-extension",
          sourcemap: false,
          // no inlined assets: extension pages allow scripts from the package only
          assetsInlineLimit: 0,
          rollupOptions: {
            input: { sidepanel: here("sidepanel.html"), background: here("src/extension/background.ts") },
            output: { entryFileNames: (chunk) => (chunk.name === "background" ? "background.js" : "assets/[name]-[hash].js") },
          },
        }
      : { outDir: "dist", sourcemap: false },
  // The site reads no build-time values: Firebase is connected by each visitor at run time.
  // A prefix nothing uses keeps a local .env.local (./dev cloud web) out of every bundle.
  envPrefix: "CONTEXTLENS_SITE_UNUSED_",
  // the shared images live in docs/assets, two levels up
  server: { fs: { allow: ["../.."] } },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    // Tests run the AI SDK's browser build, the one the page bundles (with the Chrome
    // on-device adapter); under Node its exports would pick the server build.
    alias: {
      "@firebase/ai": here("./node_modules/@firebase/ai/dist/esm/index.esm.js"),
      "@firebase/auth": here("./node_modules/@firebase/auth/dist/esm/index.js"),
    },
    server: { deps: { inline: [/firebase/] } },
  },
}));

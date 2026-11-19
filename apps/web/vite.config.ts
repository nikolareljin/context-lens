import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Served from GitHub Pages at https://nikolareljin.github.io/context-lens/ (docs under /context-lens/docs/).
export default defineConfig({
  base: "/context-lens/",
  plugins: [react(), tailwindcss()],
  build: { outDir: "dist", sourcemap: false },
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
      "@firebase/ai": fileURLToPath(new URL("./node_modules/@firebase/ai/dist/esm/index.esm.js", import.meta.url)),
      "@firebase/auth": fileURLToPath(new URL("./node_modules/@firebase/auth/dist/esm/index.js", import.meta.url)),
    },
    server: { deps: { inline: [/firebase/] } },
  },
});

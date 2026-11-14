import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Served from GitHub Pages at https://nikolareljin.github.io/context-lens/ (docs under /context-lens/docs/).
export default defineConfig({
  base: "/context-lens/",
  plugins: [react(), tailwindcss()],
  build: { outDir: "dist", sourcemap: false },
  // the shared images live in docs/assets, two levels up
  server: { fs: { allow: ["../.."] } },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});

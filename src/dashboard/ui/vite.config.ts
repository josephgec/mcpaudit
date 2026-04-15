import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// vite serves from this directory and emits a fully-static SPA into
// dist/dashboard/ui at the repo root, where dashboard/server.ts looks for it.
export default defineConfig({
  root: resolve(import.meta.dirname),
  base: "/",
  plugins: [react()],
  build: {
    outDir: resolve(import.meta.dirname, "../../../dist/dashboard/ui"),
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: resolve(import.meta.dirname, "index.html"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:3101",
    },
  },
});

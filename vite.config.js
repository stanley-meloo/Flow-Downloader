import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Split the bundle into a few files by library (it was one ~1.7 MB file,
  // which triggered Vite's "chunks larger than 500 kB" warning). It's a
  // desktop app reading its files from disk, so this is about tidiness and
  // caching between updates rather than download speed.
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("/three/")) return "three";                 // WebGL (Floating Lines)
            if (/\/(react|react-dom|scheduler)\//.test(id)) return "react";
            if (/\/(framer-motion|motion-dom|motion-utils)\//.test(id)) return "motion";
            return "vendor";                                              // i18next, Tauri API, Lenis, …
          }
          if (id.includes("/src/locales/") && id.endsWith(".json")) return "locales"; // the 16 languages
        },
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));

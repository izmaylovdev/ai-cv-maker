import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { copyFileSync, mkdirSync } from "fs";

const outDir = resolve(__dirname, "../../dist/apps/chrome-extension");

const copyManifest = {
  name: "copy-manifest",
  closeBundle() {
    mkdirSync(resolve(outDir, "popup"), { recursive: true });
    copyFileSync(resolve(__dirname, "manifest.json"), resolve(outDir, "manifest.json"));
  },
};

export default defineConfig({
  test: {
    environment: "jsdom",
  },
  plugins: [react(), copyManifest],
  build: {
    outDir,
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: resolve(__dirname, "src/background.ts"),
        content: resolve(__dirname, "src/content.ts"),
        popup: resolve(__dirname, "popup/index.html"),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === "popup" ? "popup/[name].js" : "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});

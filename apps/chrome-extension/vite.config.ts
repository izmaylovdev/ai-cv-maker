import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from "fs";

const outDir = resolve(__dirname, "../../dist/apps/chrome-extension");

const copyManifest = {
  name: "copy-manifest",
  closeBundle() {
    mkdirSync(resolve(outDir, "panel"), { recursive: true });
    const raw = readFileSync(resolve(__dirname, "manifest.json"), "utf-8");
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const output = clientId
      ? raw.replace(/"client_id"\s*:\s*"[^"]*"/, `"client_id": "${clientId}"`)
      : raw;
    writeFileSync(resolve(outDir, "manifest.json"), output);

    // US-EXT-4 — bundle the chat-ui IIFE so the side panel hosts <ai-chat-widget>
    // without a network dependency on the chat-ui dev server. Build chat-ui first
    // (the `build` target dependsOn chat-ui:build).
    const widget = resolve(__dirname, "../../dist/apps/chat-ui/chat-widget.js");
    if (existsSync(widget)) {
      copyFileSync(widget, resolve(outDir, "panel/chat-widget.js"));
    } else {
      this.warn(
        "chat-widget.js not found at dist/apps/chat-ui — build chat-ui before the extension (npx nx build chat-ui).",
      );
    }
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
        panel: resolve(__dirname, "panel/index.html"),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === "panel" ? "panel/[name].js" : "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});

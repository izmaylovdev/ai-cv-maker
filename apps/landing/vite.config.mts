/// <reference types='vitest' />
import { defineConfig } from 'vite';

// Static marketing site. `index.html` at the project root is the Vite entry —
// no framework, no TS source, just a single self-contained page.
export default defineConfig({
  root: __dirname,
  base: '/',
  cacheDir: '../../node_modules/.vite/landing',
  server: {
    port: 4203,
    host: 'localhost',
  },
  preview: {
    port: 4203,
    host: 'localhost',
  },
  build: {
    outDir: '../../dist/apps/landing',
    emptyOutDir: true,
    reportCompressedSize: true,
    commonjsOptions: { transformMixedEsModules: true },
  },
});

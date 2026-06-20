import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';
import cssInjectedByJs from 'vite-plugin-css-injected-by-js';

// Mirrors apps/chat-ui: a React app built as a single self-contained IIFE that
// registers a custom element. CSS is injected into the JS so the artifact has
// no external stylesheet. The dev server (own port) serves the index.html
// harness directly.
export default defineConfig(({ command }) => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/apps/profile-builder-ui',
  plugins: [
    react(),
    nxViteTsPaths(),
    ...(command === 'build' ? [cssInjectedByJs()] : []),
  ],
  define: {
    'process.env.NODE_ENV': command === 'build' ? '"production"' : '"development"',
  },
  server: {
    port: 4203,
    host: 'localhost',
    cors: true,
  },
  preview: {
    port: 4203,
    host: 'localhost',
    cors: true,
  },
  build: {
    outDir: '../../dist/apps/profile-builder-ui',
    emptyOutDir: true,
    lib: {
      entry: 'src/main.tsx',
      name: 'ProfileBuilderWidget',
      formats: ['iife'],
      fileName: () => 'profile-builder.js',
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
}));

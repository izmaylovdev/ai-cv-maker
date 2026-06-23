import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';
import cssInjectedByJs from 'vite-plugin-css-injected-by-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Dev-only plugin: intercepts GET /profile-builder.js and returns an on-demand
 * IIFE bundle built with esbuild (which Vite already ships). CSS is injected via
 * a tiny runtime shim so the widget is fully self-contained, matching production.
 * Mirrors apps/chat-ui's widgetDevBundlePlugin so the Angular host can load the
 * builder the same way it loads the chat widget.
 */
function widgetDevBundlePlugin(): Plugin {
  const entry = resolve(import.meta.dirname, 'src/main.tsx');
  let cachedJs: string | null = null;

  const cssInjectPlugin = {
    name: 'css-text-inject',
    setup(build: import('esbuild').PluginBuild) {
      build.onLoad({ filter: /\.css$/ }, async (args) => {
        const css = readFileSync(args.path, 'utf-8');
        return {
          contents: `
const __css__ = ${JSON.stringify(css)};
(function(){
  if (typeof document === 'undefined') return;
  var s = document.createElement('style');
  s.textContent = __css__;
  document.head.appendChild(s);
})();
`,
          loader: 'js',
        };
      });
    },
  };

  async function buildBundle(): Promise<string> {
    const esbuild = await import('esbuild');
    const result = await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      format: 'iife',
      write: false,
      define: { 'process.env.NODE_ENV': '"development"' },
      jsx: 'automatic',
      plugins: [cssInjectPlugin],
      logLevel: 'warning',
    });
    return result.outputFiles[0].text;
  }

  return {
    name: 'widget-dev-bundle',
    apply: 'serve',
    configureServer(server) {
      server.watcher.on('change', () => {
        cachedJs = null;
      });

      server.middlewares.use('/profile-builder.js', async (_req, res) => {
        try {
          if (!cachedJs) {
            cachedJs = await buildBundle();
          }
          res.setHeader('Content-Type', 'application/javascript');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.end(cachedJs);
        } catch (err) {
          console.error('[widget-dev-bundle] Build failed:', err);
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end(String(err));
        }
      });
    },
  };
}

// Mirrors apps/chat-ui: a React app built as a single self-contained IIFE that
// registers a custom element. CSS is injected into the JS so the artifact has
// no external stylesheet. The dev server (own port) serves /profile-builder.js
// as an on-demand esbuild IIFE so the Angular host can load it like the chat
// widget; the index.html harness is still served directly for standalone dev.
export default defineConfig(({ command }) => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/apps/profile-builder-ui',
  plugins: [
    react(),
    nxViteTsPaths(),
    ...(command === 'build' ? [cssInjectedByJs()] : []),
    ...(command === 'serve' ? [widgetDevBundlePlugin()] : []),
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
    // Unit tests live in src/; e2e/ is Playwright (run via the `e2e` target) and
    // must not be collected by vitest.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
}));

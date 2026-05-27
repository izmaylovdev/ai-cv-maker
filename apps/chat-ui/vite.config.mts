import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';
import cssInjectedByJs from 'vite-plugin-css-injected-by-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Dev-only plugin: intercepts GET /chat-widget.js and returns an on-demand IIFE
 * bundle built with esbuild (which Vite already ships). CSS is injected via a
 * tiny runtime shim so the widget is fully self-contained, matching production.
 *
 * The bundle is cached after the first request and invalidated whenever any
 * watched source file changes, giving HMR-like freshness without a full reload.
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
    // esbuild is bundled with Vite — no extra dep needed
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
      // Invalidate the cache whenever any project file changes
      server.watcher.on('change', () => {
        cachedJs = null;
      });

      server.middlewares.use('/chat-widget.js', async (_req, res) => {
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

export default defineConfig(({ command }) => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/apps/chat-ui',
  plugins: [
    react(),
    nxViteTsPaths(),
    // Production build: inject CSS into the IIFE via the official plugin
    ...(command === 'build' ? [cssInjectedByJs()] : []),
    // Dev server: serve /chat-widget.js as an on-demand esbuild IIFE
    ...(command === 'serve' ? [widgetDevBundlePlugin()] : []),
  ],
  define: {
    'process.env.NODE_ENV': command === 'build' ? '"production"' : '"development"',
  },
  server: {
    port: 4202,
    host: 'localhost',
    cors: true,
  },
  preview: {
    port: 4202,
    host: 'localhost',
    cors: true,
  },
  build: {
    outDir: '../../dist/apps/chat-ui',
    emptyOutDir: true,
    lib: {
      entry: 'src/main.tsx',
      name: 'ChatWidget',
      formats: ['iife'],
      fileName: () => 'chat-widget.js',
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
}));

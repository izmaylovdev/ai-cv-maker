import { defineConfig, preprocessCSS, type Alias, type Plugin, type ResolvedConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';
import cssInjectedByJs from 'vite-plugin-css-injected-by-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { widgetPostcssPlugins } from './widget-css.mts';

const stub = (file: string) => resolve(import.meta.dirname, 'src/stubs', file);

/**
 * LlamaIndex Chat UI ships one widgets bundle, so importing its chat components
 * also pulls in features <ai-chat-widget> never renders (canvas code/document
 * editors, PDF previews, LlamaDeploy workflows). Those packages are swapped for
 * no-op stubs to keep the IIFE small — and, for `vaul` / `@mdxeditor/editor`, to
 * stop them injecting unscoped global styles into the host page on import.
 * highlight.js is narrowed to its "common" language set.
 *
 * Exact-match patterns only, so e.g. `highlight.js/lib/common` itself still
 * resolves. Shared by the production build, the dev `/chat-widget.js` bundle
 * and vitest.
 */
const widgetAliases: Alias[] = [
  { find: /^@llamaindex\/pdf-viewer$/, replacement: stub('pdf-viewer.tsx') },
  { find: /^@mdxeditor\/editor$/, replacement: stub('mdxeditor.tsx') },
  { find: /^@uiw\/react-codemirror$/, replacement: stub('codemirror.tsx') },
  { find: /^@uiw\/codemirror-theme-github$/, replacement: stub('codemirror.tsx') },
  { find: /^@codemirror\/lang-(css|html|javascript|python)$/, replacement: stub('codemirror.tsx') },
  { find: /^@llamaindex\/llama-deploy$/, replacement: stub('llama-deploy.ts') },
  { find: /^vaul$/, replacement: stub('vaul.tsx') },
  { find: /^highlight\.js$/, replacement: 'highlight.js/lib/common' },
];

/**
 * Dev-only plugin: intercepts GET /chat-widget.js and returns an on-demand IIFE
 * bundle built with esbuild (which Vite already ships). CSS runs through Vite's
 * CSS pipeline exactly as in the production build (Tailwind + widget scoping)
 * and is injected via a tiny runtime shim, so the widget is fully
 * self-contained, matching production.
 *
 * The bundle is cached after the first request and invalidated whenever any
 * watched source file changes, giving HMR-like freshness without a full reload.
 */
function widgetDevBundlePlugin(): Plugin {
  const entry = resolve(import.meta.dirname, 'src/main.tsx');
  let cachedJs: string | null = null;
  let config: ResolvedConfig;

  const cssInjectPlugin = {
    name: 'css-text-inject',
    setup(build: import('esbuild').PluginBuild) {
      build.onLoad({ filter: /\.css$/ }, async (args) => {
        // Vite's own CSS pipeline (`@import` inlining + `css.postcss` plugins).
        const { code: css } = await preprocessCSS(readFileSync(args.path, 'utf-8'), args.path, config);
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

  // Mirrors `widgetAliases` for esbuild.
  const aliasPlugin = {
    name: 'widget-aliases',
    setup(build: import('esbuild').PluginBuild) {
      for (const { find, replacement } of widgetAliases) {
        build.onResolve({ filter: find as RegExp }, (args) =>
          replacement.startsWith('/')
            ? { path: replacement }
            : build.resolve(replacement, { resolveDir: args.resolveDir, kind: args.kind }),
        );
      }
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
      plugins: [aliasPlugin, cssInjectPlugin],
      logLevel: 'warning',
    });
    return result.outputFiles[0].text;
  }

  return {
    name: 'widget-dev-bundle',
    apply: 'serve',
    configResolved(resolved) {
      config = resolved;
    },
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
  resolve: {
    alias: widgetAliases,
  },
  css: {
    postcss: {
      plugins: widgetPostcssPlugins(),
    },
  },
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
  test: {
    environment: 'jsdom',
    globals: true,
    server: {
      deps: {
        // Chat UI must go through Vite's resolver so `widgetAliases` apply to its
        // imports — loaded natively, `@mdxeditor/editor` crashes jsdom on import.
        inline: [/@llamaindex\/chat-ui/],
      },
    },
  },
}));

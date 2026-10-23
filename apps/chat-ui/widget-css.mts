import tailwindcss from '@tailwindcss/postcss';
import prefixSelector from 'postcss-prefix-selector';
import type { AtRule, Container, Plugin, Rule } from 'postcss';
import type { UserConfig } from 'vite';

/**
 * The PostCSS chain every widget stylesheet goes through — in the production
 * build (Vite `css.postcss`) and in the dev `/chat-widget.js` bundle alike, so
 * both ship the same CSS.
 *
 * <ai-chat-widget> renders in the host's light DOM, so nothing it injects may
 * match an element outside it. Tailwind (preflight included), the theme tokens
 * and Chat UI's markdown.css are compiled, then every selector is re-rooted
 * under the `ai-chat-widget` element.
 */

export const WIDGET_TAG = 'ai-chat-widget';

const ALREADY_SCOPED = new RegExp(`^${WIDGET_TAG}(?![\\w-])`);
// Document-level roots: stand in for the widget element itself.
const GLOBAL_ROOT = /^(?::root|html|body|:host)(?![\w-])/;
// The app's theme class on <html>.
const DARK_ROOT = /^\.dark(?![\w-])/;

/**
 * Re-root one selector under the widget:
 *   `:root` / `html` / `body` / `:host`  → `ai-chat-widget`
 *   `.dark` / `.dark .x`                 → `:where(.dark) ai-chat-widget` / `… .x`
 *   anything else (`*`, `::before`, `.x`) → `ai-chat-widget <selector>`
 */
export function scopeSelector(selector: string): string {
  const s = selector.trim();
  if (ALREADY_SCOPED.test(s) || s.startsWith(`:where(.dark) ${WIDGET_TAG}`)) return s;

  if (DARK_ROOT.test(s)) {
    const rest = s.replace(DARK_ROOT, '').trim().replace(/^>\s*/, '');
    // `:where()` keeps the theme context from adding specificity, so dark tokens
    // override light ones purely by source order.
    return rest ? `:where(.dark) ${WIDGET_TAG} ${rest}` : `:where(.dark) ${WIDGET_TAG}`;
  }

  if (GLOBAL_ROOT.test(s)) return WIDGET_TAG + s.replace(GLOBAL_ROOT, '');

  return `${WIDGET_TAG} ${s}`;
}

function nestedInRule(rule: Rule): boolean {
  for (let p = rule.parent as Container | undefined; p; p = p.parent as Container | undefined) {
    if (p.type === 'rule') return true;
  }
  return false;
}

/**
 * Drop KaTeX's `@font-face` rules (from Chat UI's markdown.css): their font files
 * would be inlined into the IIFE (~1 MB). Math is rare in chat replies (Chat UI
 * escapes `$`) and KaTeX falls back to system fonts. Runs as `Once`, right after
 * Tailwind has inlined the imports and before Vite tries to resolve the font URLs.
 */
const dropKatexFonts: Plugin = {
  postcssPlugin: 'applysy-drop-katex-fonts',
  Once(root) {
    root.walkAtRules('font-face', (at: AtRule) => {
      let family = '';
      at.walkDecls('font-family', (d) => {
        family = d.value;
      });
      if (/katex/i.test(family)) at.remove();
    });
  },
};

/**
 * Housekeeping after scoping:
 *  - unwrap `@layer` blocks. Cascade layers lose to *any* unlayered host rule
 *    (the Angular app ships unlayered `button`/`textarea`/`*` styles), and a host
 *    that also uses Tailwind would merge its layers with ours. Unlayered, the
 *    widget's rules keep Tailwind's source order (theme → base → utilities) and
 *    always carry the extra `ai-chat-widget` specificity over host element rules.
 *  - de-duplicate selectors (`:root, :host` both become `ai-chat-widget`).
 */
const widgetCssCleanup: Plugin = {
  postcssPlugin: 'applysy-widget-css-cleanup',
  OnceExit(root) {
    let unwrapped = true;
    while (unwrapped) {
      unwrapped = false;
      root.walkAtRules('layer', (at: AtRule) => {
        unwrapped = true;
        if (at.nodes && at.nodes.length) at.replaceWith(at.nodes);
        else at.remove(); // `@layer a, b;` order statement
      });
    }

    root.walkRules((rule) => {
      const unique = Array.from(new Set(rule.selectors));
      if (unique.length !== rule.selectors.length) rule.selectors = unique;
    });
  },
};

// Vite, Tailwind and the repo root each resolve their own copy of postcss, whose
// plugin types are nominally incompatible; any PostCSS 8 plugin runs on any
// PostCSS 8 runner, so the list is typed as what Vite's `css.postcss` accepts.
type VitePostcssPlugins = NonNullable<
  Exclude<NonNullable<NonNullable<UserConfig['css']>['postcss']>, string>['plugins']
>;

export function widgetPostcssPlugins(): VitePostcssPlugins {
  const plugins: unknown[] = [
    // Flatten nesting (lightningcss) in dev and prod alike so both bundles carry
    // the same, plain selectors; Vite minifies the production CSS afterwards.
    tailwindcss({ optimize: { minify: false } }),
    dropKatexFonts,
    prefixSelector({
      prefix: WIDGET_TAG,
      // Nested rules (`&:hover`) are relative to an already-scoped parent.
      transform: (_prefix, selector, _prefixed, _file, rule) =>
        nestedInRule(rule) ? selector : scopeSelector(selector),
    }),
    widgetCssCleanup,
  ];
  return plugins as VitePostcssPlugins;
}

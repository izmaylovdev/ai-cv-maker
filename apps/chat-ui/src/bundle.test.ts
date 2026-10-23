// @vitest-environment node
//
// Build check for the production widget bundle (dist/apps/chat-ui/chat-widget.js).
// Skipped when the bundle has not been built — run
//   npx vite build --config apps/chat-ui/vite.config.mts
// from the repo root first.
//
// The widget renders in the host's light DOM, so every CSS rule it ships must be
// scoped to <ai-chat-widget>: nothing it injects may match an element outside it
// (the Angular nav, profile editor, buttons, inputs). The bundle is executed in a
// fresh jsdom window and the stylesheet it injects into <head> is inspected.
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import { JSDOM, VirtualConsole } from 'jsdom';
import postcss, { type AtRule, type Container, type Rule } from 'postcss';

const BUNDLE = fileURLToPath(new URL('../../../dist/apps/chat-ui/chat-widget.js', import.meta.url));
const TAG = 'ai-chat-widget';
const MAX_BYTES = 1.2 * 1024 * 1024;

/**
 * Reduce a selector to its top-level structure: drop the contents of pseudo-class
 * arguments `(...)`, attribute selectors `[...]`, quoted strings and escaped
 * characters (Tailwind class names such as `.max-h-\[400px\]`).
 */
function topLevelStructure(selector: string): string {
  let out = '';
  let parens = 0;
  let brackets = 0;
  let quote: string | null = null;
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i];
    if (ch === '\\') {
      i++;
      if (!parens && !brackets && !quote) out += '_';
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '[') {
      brackets++;
      continue;
    }
    if (ch === ']') {
      brackets--;
      continue;
    }
    if (brackets) continue;
    if (ch === '(') {
      if (parens++ === 0) out += '(';
      continue;
    }
    if (ch === ')') {
      if (--parens === 0) out += ')';
      continue;
    }
    if (parens) continue;
    out += ch;
  }
  return out.trim();
}

/**
 * A selector is scoped when its subject can only ever be the widget element or a
 * descendant of it: some compound starts with the `ai-chat-widget` type selector
 * and only descendant/child combinators follow it. This accepts
 * `ai-chat-widget .x`, `ai-chat-widget` and a theme context such as
 * `:where(.dark) ai-chat-widget .x`; it rejects `.x`, `:root`, `html`, `body`,
 * `*` and sibling escapes like `ai-chat-widget ~ .x`.
 */
function isScopedToWidget(selector: string): boolean {
  const tokens = topLevelStructure(selector)
    .split(/\s*([>+~])\s*|\s+/)
    .filter((t): t is string => typeof t === 'string' && t.length > 0);
  let anchor = -1;
  tokens.forEach((t, i) => {
    if (new RegExp(`^${TAG}(?![\\w-])`).test(t)) anchor = i;
  });
  if (anchor === -1) return false;
  return !tokens.slice(anchor + 1).some((t) => t === '+' || t === '~');
}

function insideKeyframes(node: Rule): boolean {
  for (let p: Container | undefined = node.parent as Container | undefined; p; p = p.parent as Container | undefined) {
    if (p.type === 'atrule' && /keyframes$/i.test((p as AtRule).name)) return true;
  }
  return false;
}

function nestedInRule(node: Rule): boolean {
  for (let p: Container | undefined = node.parent as Container | undefined; p; p = p.parent as Container | undefined) {
    if (p.type === 'rule') return true;
  }
  return false;
}

describe.skipIf(!existsSync(BUNDLE))('chat-widget.js production bundle', () => {
  let window: JSDOM['window'];
  let executionError: unknown = null;
  let injectedCss = '';

  beforeAll(() => {
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', (e) => {
      // CSS parse warnings from jsdom's CSSOM are irrelevant here; script errors are not.
      if (!/Could not parse CSS stylesheet/i.test(String(e?.message ?? e))) executionError ??= e;
    });
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
      runScripts: 'outside-only',
      pretendToBeVisual: true,
      url: 'http://localhost/',
      virtualConsole,
    });
    window = dom.window;
    try {
      window.eval(readFileSync(BUNDLE, 'utf-8'));
    } catch (e) {
      executionError = e;
    }
    injectedCss = Array.from(window.document.querySelectorAll('style'))
      .map((s) => s.textContent ?? '')
      .join('\n');
  });

  it(`is smaller than ${MAX_BYTES} bytes (1.2 MiB)`, () => {
    expect(statSync(BUNDLE).size).toBeLessThan(MAX_BYTES);
  });

  it('defines the <ai-chat-widget> custom element when executed', () => {
    expect(executionError).toBeNull();
    expect(window.customElements.get(TAG)).toBeDefined();
  });

  it('injects its stylesheet into <head> when executed', () => {
    expect(injectedCss.length).toBeGreaterThan(0);
  });

  it('scopes every injected style rule to ai-chat-widget (no style can leak to the host page)', () => {
    expect(injectedCss.length).toBeGreaterThan(0);
    const root = postcss.parse(injectedCss);

    const unscoped: string[] = [];
    let checked = 0;
    root.walkRules((rule) => {
      // @keyframes steps (from / to / 50%) are not element selectors; nested
      // rules (`&:hover`) are relative to their already-checked parent.
      if (insideKeyframes(rule) || nestedInRule(rule)) return;
      for (const selector of rule.selectors) {
        checked++;
        if (!isScopedToWidget(selector)) unscoped.push(selector);
      }
    });

    expect(checked).toBeGreaterThan(0);
    // Show a readable sample on failure instead of thousands of selectors.
    expect({ count: unscoped.length, sample: unscoped.slice(0, 25) }).toEqual({ count: 0, sample: [] });
  });

  it('declares no global custom properties on :root / html / body / *', () => {
    const root = postcss.parse(injectedCss);
    const globalVarRules: string[] = [];
    root.walkRules((rule) => {
      if (insideKeyframes(rule) || nestedInRule(rule)) return;
      const declaresVars = rule.nodes.some((n) => n.type === 'decl' && n.prop.startsWith('--'));
      if (!declaresVars) return;
      for (const selector of rule.selectors) {
        if (/^(:root|html|body|\*|:host)\b/.test(selector.trim())) globalVarRules.push(selector);
      }
    });
    expect(globalVarRules).toEqual([]);
  });
});

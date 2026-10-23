# ADR-0022: Build the chat widget on LlamaIndex Chat UI

- **Status:** Accepted
- **Date:** 2026-10-19

## Context

`<ai-chat-widget>` (`apps/chat-ui`) had a hand-rolled message list, composer
and about 440 lines of bespoke CSS. Every chat improvement, such as code
highlighting or better message layout, meant building and styling it ourselves.
[LlamaIndex Chat UI](https://ui.llamaindex.ai/) (`@llamaindex/chat-ui`) is a
maintained React component library for LLM chat that already does this.

The widget has some constraints:

- It is one IIFE script, loaded into `ui-angular` and into the Chrome extension
  side panel.
- It renders in light DOM and follows the host's `.dark` class.
- Its host contract (attributes, properties, `edit`/`fill` events and
  `addAssistantNote`) must not change.
- `/api/chat` is non-streaming JSON.

Chat UI has its own constraints:

- It is styled with Tailwind and shadcn tokens, with unscoped class names and
  `:root` variables.
- Its single entry point statically imports a PDF viewer, an MDX editor,
  CodeMirror, LlamaDeploy, KaTeX and every highlight.js language. A naive bundle
  is about 3.7 MB minified (1.2 MB gzipped), against our previous 362 KB
  (112 KB gzipped).
- The vaul drawer injects a global `<style>` as soon as it is imported.

## Decision

We build the widget's internals on `@llamaindex/chat-ui` and keep the custom
element and its contract unchanged.

- **Handler.** A custom `ChatHandler` (`useApplysyChat`) adapts our
  request/response API to Chat UI. Error replies and fill drafts travel as
  custom `data-error` / `data-fill` message parts that our own components
  render.
- **Style isolation.** The widget stays in light DOM, and every CSS rule it ships
  passes through one PostCSS chain (`apps/chat-ui/widget-css.mts`):
  - Tailwind v4.
  - `postcss-prefix-selector`, which scopes every selector under
    `ai-chat-widget` and maps `:root`/`html`/`body` onto the element.
  - A pass that unwraps cascade layers, so the host's unlayered CSS cannot
    override the widget's utilities.

  Dev (esbuild) and production (Vite) use the same chain.
- **Bundle trimming.**
  - Exact-match `resolve.alias` entries replace the PDF viewer, MDX editor,
    CodeMirror, LlamaDeploy and vaul with no-op ESM stubs (`src/stubs/`).
  - `highlight.js` resolves to its common-languages build.
  - KaTeX's `@font-face` rules are dropped.

  The result is about 1.05 MB minified (about 317 KB gzipped).
- **Build check.** `src/bundle.test.ts` fails if the bundle passes 1.2 MiB or if
  any injected rule escapes the `ai-chat-widget` scope.

## Alternatives considered

- **Keep the hand-rolled UI.** No new dependency and a smaller bundle, but we
  would keep building chat features that a maintained library already provides.
- **Shadow DOM.** Isolates styles both ways, but has three problems:
  - Tailwind v4's `@property` registrations are ignored inside shadow roots,
    which breaks shadows and rings.
  - Following `.dark` on `<html>` would need `:host-context`, which Firefox does
    not support, or a MutationObserver.
  - Chat UI's Radix portals would render outside the root unstyled.
- **Import Chat UI unmodified.** Simplest, but it costs about 1.2 MB gzipped on
  every page that opens the chat, mostly for features we never render.
- **Copy component source via the shadcn registry.** The registry entry only adds
  the npm dependency and an example file, so it does not avoid the bundle or CSS
  problems.

## Consequences

- The widget is about 3× larger gzipped (112 KB → about 317 KB). It is still
  loaded lazily, only on pages that host the chat.
- Upgrading `@llamaindex/chat-ui` needs care:
  - If it starts importing a new heavy module or a new named export from a
    stubbed package, the stubs in `src/stubs/` must follow. The build check and
    tests will catch the failure, but not the cause.
  - Chat UI's nested `react-markdown` v8 types need the global JSX shim in
    `src/react-markdown-jsx.d.ts` while they rely on React's removed global
    `JSX` namespace.
- `@property --tw-*` registrations and the `spin`/`pulse` keyframes stay global.
  They match the ones `ui-angular` (also Tailwind v4) registers, so they are
  harmless. Revisit if the host stops using Tailwind v4.
- Streaming replies, file upload, citations and canvas become cheap to add later
  because Chat UI already supports them. Each one means un-stubbing the matching
  package and re-checking the bundle budget.

// Build-time stand-in for the CodeMirror packages Chat UI's widgets bundle imports
// (`@uiw/react-codemirror`, `@uiw/codemirror-theme-github`, `@codemirror/lang-*`).
// They only power the canvas code-artifact editor, which <ai-chat-widget> never
// renders; aliasing them here keeps ~400 KB out of the IIFE. Every name Chat UI
// imports must exist as a real ESM export (see vite.config.mts `resolve.alias`).

const noExtension = () => [];

export const javascript = noExtension;
export const python = noExtension;
export const html = noExtension;
export const css = noExtension;
export const githubLight: unknown[] = [];

export default function CodeMirror() {
  return null;
}

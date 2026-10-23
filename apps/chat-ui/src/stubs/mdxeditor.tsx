// Build-time stand-in for `@mdxeditor/editor`, which Chat UI's widgets bundle
// imports for the canvas document editor. <ai-chat-widget> never renders it, and
// the real package injects global styles on import (stitches `insertRule`), so it
// is aliased here (see vite.config.mts `resolve.alias`). Every name Chat UI
// imports must exist as a real ESM export.

const noPlugin = () => ({});
const Nothing = () => null;

export const headingsPlugin = noPlugin;
export const listsPlugin = noPlugin;
export const linkPlugin = noPlugin;
export const linkDialogPlugin = noPlugin;
export const tablePlugin = noPlugin;
export const markdownShortcutPlugin = noPlugin;
export const thematicBreakPlugin = noPlugin;
export const quotePlugin = noPlugin;
export const imagePlugin = noPlugin;
export const toolbarPlugin = noPlugin;

export const UndoRedo = Nothing;
export const BoldItalicUnderlineToggles = Nothing;
export const BlockTypeSelect = Nothing;
export const MDXEditor = Nothing;

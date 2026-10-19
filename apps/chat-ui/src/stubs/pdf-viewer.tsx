// Build-time stand-in for `@llamaindex/pdf-viewer`, lazily imported by Chat UI's
// PDF source preview. <ai-chat-widget> never shows PDF sources (see
// vite.config.mts `resolve.alias`).

export function PDFViewer() {
  return null;
}

export function PdfFocusProvider({ children }: { children?: unknown }) {
  return (children ?? null) as null;
}

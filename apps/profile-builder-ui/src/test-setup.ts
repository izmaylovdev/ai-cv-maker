// jsdom has no layout, and its Range lacks getBoundingClientRect /
// getClientRects. Lexical calls them to scroll a collapsed caret into view
// whenever the editor holds focus, so tests that drive the real editor need a
// zero-size stand-in.
if (typeof Range !== 'undefined') {
  if (!Range.prototype.getBoundingClientRect) {
    Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
  }
  if (!Range.prototype.getClientRects) {
    Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  }
}

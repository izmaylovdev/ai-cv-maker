// react-markdown v8 (bundled with @llamaindex/chat-ui) ships `.ts` type sources
// written against React's legacy global `JSX` namespace, which @types/react 19
// no longer declares. Re-expose React's intrinsic elements there so the Chat UI
// typings check.
import type { JSX as ReactJSX } from 'react';

declare global {
  namespace JSX {
    // Must be an interface (not a type alias) so it merges with any other
    // global declaration of the same name.
    // eslint-disable-next-line @typescript-eslint/no-empty-interface, @typescript-eslint/no-empty-object-type
    interface IntrinsicElements extends ReactJSX.IntrinsicElements {}
  }
}

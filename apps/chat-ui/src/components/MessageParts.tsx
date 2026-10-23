import type { AnchorHTMLAttributes } from 'react';
import { usePart } from '@llamaindex/chat-ui';
import { ERROR_PART, FILL_PART, type TextData } from '../useApplysyChat';

interface DataPart {
  type: string;
  data: TextData;
}

/**
 * User text is literal — no Markdown parsing — with the author's line breaks
 * preserved (F-CHAT-5.4).
 */
export function UserTextPart() {
  const part = usePart('text');
  if (!part) return null;
  return (
    <div className="bg-primary text-primary-foreground ml-auto w-fit max-w-[80%] whitespace-pre-wrap break-words rounded-xl px-3 py-2">
      {part.text}
    </div>
  );
}

/**
 * US-AI-11 — a failed request: the server's message (or the generic fallback),
 * shown literally in a distinct bubble that assistive tech announces.
 */
export function ErrorPart() {
  const part = usePart<DataPart>(ERROR_PART);
  if (!part) return null;
  return (
    <div
      role="alert"
      className="chat-error border-destructive/30 bg-destructive/10 text-destructive w-fit max-w-[80%] whitespace-pre-wrap break-words rounded-xl border px-3 py-2"
    >
      {part.data.text}
    </div>
  );
}

/**
 * US-EXT-4 — "Use this" under a fillable draft (e.g. a cover letter). Nothing is
 * filled until the user clicks it.
 */
export function FillAction({ onFill }: { onFill?: (text: string) => void }) {
  // Rendered once per message part, so it shows only for the `data-fill` part.
  const fill = usePart<DataPart>(FILL_PART);
  if (!fill || !onFill) return null;
  return (
    <button
      type="button"
      className="bg-primary text-primary-foreground hover:bg-primary/90 w-fit rounded-md px-3.5 py-1.5 text-[13px] font-medium"
      onClick={() => onFill(fill.data.text)}
    >
      Use this
    </button>
  );
}

/**
 * Markdown links open in a new tab without leaking the referrer (F-CHAT-5.7).
 * Chat UI calls Markdown component overrides as plain functions, so this must
 * not use hooks.
 */
export function MarkdownLink({ href, children }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

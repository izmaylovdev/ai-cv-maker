import { useLayoutEffect, useRef } from 'react';
import { ChatInput, useChatInput, useChatUI } from '@llamaindex/chat-ui';

/**
 * The message textarea. Keyboard handling comes from Chat UI's input context
 * (Enter sends, Shift+Enter inserts a newline, nothing is sent mid IME
 * composition); unlike the stock `ChatInput.Field` it starts at one row, grows
 * with its content up to a CSS max height (then scrolls) and collapses back to
 * one row once the message is sent (F-CHAT-5.1 / F-CHAT-5.3).
 */
function ComposerField() {
  const { input, setInput } = useChatUI();
  const { handleKeyDown, isComposing, setIsComposing } = useChatInput();
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    ta.style.height = 'auto';
    if (input) {
      // scrollHeight excludes borders; box-sizing is border-box.
      ta.style.height = `${ta.scrollHeight + ta.offsetHeight - ta.clientHeight}px`;
    }
  }, [input]);

  return (
    <textarea
      ref={ref}
      name="input"
      rows={1}
      aria-label="Message"
      placeholder="Ask a question or give an instruction…"
      className="chat-composer-field bg-secondary text-foreground placeholder:text-muted-foreground focus-visible:ring-ring max-h-[200px] min-h-0 w-full flex-1 resize-none overflow-y-auto rounded-2xl border border-transparent py-3 pl-4 pr-14 text-sm leading-6 outline-none focus-visible:ring-2"
      value={input}
      onChange={(e) => setInput(e.target.value)}
      onKeyDown={(e) => {
        // Chat UI's handler returns before preventDefault() while sending is
        // disabled (empty input / reply in flight), so a bare Enter would
        // otherwise insert a newline instead of doing nothing.
        if (e.key === 'Enter' && !e.shiftKey && !isComposing) e.preventDefault();
        handleKeyDown(e);
      }}
      onCompositionStart={() => setIsComposing(true)}
      onCompositionEnd={() => {
        setTimeout(() => setIsComposing(false), 100);
      }}
    />
  );
}

/** Chat UI's composer: a <form> wrapping the textarea and a submit (send) button. */
export function Composer({ className }: { className?: string }) {
  return (
    <ChatInput className={className}>
      <ChatInput.Form className="items-end">
        <ComposerField />
        {/* Disabled on empty input or while a reply is in flight (Chat UI). */}
        <ChatInput.Submit className="bottom-1.5 right-1.5 size-9">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M8 13V3M8 3L3 8M8 3L13 8"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="sr-only">Send message</span>
        </ChatInput.Submit>
      </ChatInput.Form>
    </ChatInput>
  );
}

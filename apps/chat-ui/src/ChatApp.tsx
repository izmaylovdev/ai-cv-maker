import { useState, useRef, useEffect, useCallback } from 'react';
import { MessageList } from './components/MessageList';
import { MessageInput } from './components/MessageInput';
import './ChatApp.css';

const MAX_HISTORY_TURNS = 20;

// Shown only when the server gave us nothing usable to display (network failure
// or an unparseable error body). Classified failures carry their own message.
const GENERIC_ERROR = 'Something went wrong. Please try again.';

/**
 * US-AI-11 — cv-api classifies chat failures into `{ code, message }` (e.g.
 * `llm_edit_failed`, `usage_limit_exceeded`). Render the server's `message`
 * verbatim; fall back to {@link GENERIC_ERROR} only when the body is missing or
 * unparseable.
 */
async function resolveErrorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (body && typeof body.message === 'string' && body.message.trim()) {
      return body.message;
    }
  } catch {
    // Non-JSON / empty body — fall through to the generic message.
  }
  return GENERIC_ERROR;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'error';
  content: string;
  /**
   * US-EXT-4 — when set, this assistant message carries a fillable draft (e.g. a
   * cover letter). A "Use this" action is rendered beneath it; nothing is filled
   * until the user accepts.
   */
  fillText?: string;
}

// US-AI-9 §6.3 — an edit the assistant proposes against the open document.
export interface ChatEdit {
  patchJson: string;
  description: string;
}

// US-EXT-4 — the current page's job posting, sent as context by the side-panel
// (extension) chat. Mutually exclusive with `document` (edit mode).
export interface JobContext {
  jobTitle: string;
  jobDescription: string;
  fieldContext: string;
}

// US-EXT-4 — a fillable draft the user accepted via "Use this".
export interface ChatFill {
  text: string;
}

interface Props {
  authToken: string;
  apiBase: string;
  /**
   * The open profile document (in-editor chat only). When provided it is sent
   * as context with every message, enabling edit mode. Omitted on the global
   * read-only assistant.
   */
  document?: unknown;
  /**
   * The current page's job posting (side-panel chat only). When provided it is
   * sent as context with every message; the assistant can answer questions about
   * the role and propose a cover letter. Mutually exclusive with `document`.
   */
  jobContext?: JobContext;
  /** Called when the assistant returns an edit to apply to {@link document}. */
  onEdit?: (edit: ChatEdit) => void;
  /** Called when the user accepts a fillable draft via "Use this" (US-EXT-4). */
  onFill?: (fill: ChatFill) => void;
  /** Exposes an imperative API to the host (e.g. to append a note to the thread). */
  onReady?: (api: ChatApi) => void;
}

export interface ChatApi {
  /** Append an assistant-authored note to the thread (e.g. a rejected edit). */
  addAssistantNote: (text: string) => void;
}

export function ChatApp({ authToken, apiBase, document, jobContext, onEdit, onFill, onReady }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const addAssistantNote = useCallback((content: string) => {
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'assistant', content }]);
  }, []);

  useEffect(() => {
    onReady?.({ addAssistantNote });
  }, [onReady, addAssistantNote]);

  async function send(text: string) {
    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', content: text };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    const history = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-MAX_HISTORY_TURNS)
      .map((m) => ({ role: m.role, content: m.content }));

    try {
      const res = await fetch(`${apiBase}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        // Context is mutually exclusive: `document` → edit mode (in-editor chat);
        // `jobContext` → side-panel job chat (US-EXT-4); neither → the global
        // read-only assistant.
        body: JSON.stringify(
          document
            ? { message: text, history, document }
            : jobContext
              ? { message: text, history, jobContext }
              : { message: text, history },
        ),
      });

      if (!res.ok) {
        const content = await resolveErrorMessage(res);
        setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'error', content }]);
        return;
      }

      const data = await res.json();
      // US-EXT-4 — a `fill` proposal is a reviewable draft: attach it to the
      // message so a "Use this" action renders in-thread (never auto-applied).
      const isFill = data.proposal?.type === 'fill';
      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: data.reply,
        fillText: isFill ? (data.proposal.text ?? '') : undefined,
      };
      setMessages((prev) => [...prev, assistantMsg]);

      // Edit mode: hand any proposed edit to the host to apply to the document.
      // Fill proposals are handled via the in-thread "Use this" action, not here.
      if (data.proposal && !isFill && onEdit) {
        onEdit({
          patchJson: data.proposal.patchJson ?? data.proposal.patch_json ?? '',
          description: data.proposal.description ?? '',
        });
      }
    } catch {
      // Network failure / fetch rejection — no response to classify.
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: 'error', content: GENERIC_ERROR },
      ]);
    } finally {
      setLoading(false);
    }
  }

  const isEmpty = messages.length === 0;
  // US-AI-12 — the in-editor chat (bound to the open `document`) opens directly
  // in the conversation layout, so the greeting and the first message share the
  // same input position. The global read-only assistant keeps the centered
  // landing splash for its empty state.
  const showLanding = isEmpty && !document;

  return (
    <div className={`chat-app${showLanding ? ' chat-app--empty' : ''}`}>
      {showLanding ? (
        <div className="chat-landing">
          <div className="chat-landing__heading">How can I help you?</div>
          <MessageInput onSend={send} disabled={loading} landing />
        </div>
      ) : (
        <>
          <div className="chat-messages">
            {isEmpty ? (
              <div className="chat-empty">
                Ask me to edit your CV — add a role, rewrite a summary, or turn a
                list into chips.
              </div>
            ) : (
              <MessageList
                messages={messages}
                onFill={onFill ? (text) => onFill({ text }) : undefined}
              />
            )}
            {loading && (
              <div className="chat-typing">
                <span />
                <span />
                <span />
              </div>
            )}
            <div ref={bottomRef} />
          </div>
          <MessageInput onSend={send} disabled={loading} />
        </>
      )}
    </div>
  );
}

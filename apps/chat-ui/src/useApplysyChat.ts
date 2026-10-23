import { useCallback, useMemo, useRef, useState } from 'react';
import type { ChatHandler, Message as ChatUIMessage, MessagePart } from '@llamaindex/chat-ui';
import type { ChatEdit, JobContext, Message } from './ChatApp';

const MAX_HISTORY_TURNS = 20;

// Shown only when the server gave us nothing usable to display (network failure
// or an unparseable error body). Classified failures carry their own message.
const GENERIC_ERROR = 'Something went wrong. Please try again.';

/** Custom Chat UI part: a failed request, rendered as an error bubble. */
export const ERROR_PART = 'data-error';
/** Custom Chat UI part: a fillable draft, rendered as a "Use this" action. */
export const FILL_PART = 'data-fill';

export interface TextData {
  text: string;
}

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

/**
 * Chat UI has no `error` role and no fill action, so our messages are mapped onto
 * its `{ role, parts }` shape: errors become assistant messages carrying a single
 * `data-error` part; a fillable draft adds a `data-fill` part next to the text.
 */
function toChatUIMessage(m: Message): ChatUIMessage {
  if (m.role === 'error') {
    return { id: m.id, role: 'assistant', parts: [{ type: ERROR_PART, data: { text: m.content } }] };
  }
  const parts: MessagePart[] = [{ type: 'text', text: m.content }];
  if (m.role === 'assistant' && m.fillText !== undefined) {
    parts.push({ type: FILL_PART, data: { text: m.fillText } });
  }
  return { id: m.id, role: m.role, parts };
}

interface Options {
  authToken: string;
  apiBase: string;
  document?: unknown;
  profileId?: string;
  jobContext?: JobContext;
  onEdit?: (edit: ChatEdit) => void;
}

/**
 * The widget's Chat UI handler. Our own {@link Message} list (with the `error`
 * role and `fillText`) stays the source of truth; Chat UI gets a mapped view of
 * it plus a `sendMessage` that POSTs to cv-api's `/chat`.
 */
export function useApplysyChat({ authToken, apiBase, document, profileId, jobContext, onEdit }: Options) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  // The thread as of the last render — history is read from here so a send never
  // works from a stale closure.
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const inFlight = useRef(false);
  // US-AI-16 — one conversation = one widget mount. Mint a stable session id once
  // per mount and send it on every POST /chat so all messages group under a single
  // Langfuse Session. A page reload remounts the widget → a fresh id → a new Session.
  const sessionId = useRef(crypto.randomUUID()).current;

  // Keep each mapped message referentially stable so Chat UI's memoised
  // ChatMessage skips re-rendering earlier turns.
  const mapped = useRef(new WeakMap<Message, ChatUIMessage>());
  const chatUIMessages = useMemo(
    () =>
      messages.map((m) => {
        let out = mapped.current.get(m);
        if (!out) {
          out = toChatUIMessage(m);
          mapped.current.set(m, out);
        }
        return out;
      }),
    [messages],
  );

  const addAssistantNote = useCallback((content: string) => {
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'assistant', content }]);
  }, []);

  async function send(text: string) {
    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', content: text };
    // Error bubbles are never sent back to the model.
    const history = messagesRef.current
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-MAX_HISTORY_TURNS)
      .map((m) => ({ role: m.role, content: m.content }));

    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

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
        body: JSON.stringify({
          message: text,
          history,
          // US-AI-16 — sessionId rides alongside the mutually-exclusive context so
          // no branch can forget it.
          sessionId,
          ...(document
            ? { document, profileId }
            : jobContext
              ? { jobContext }
              : {}),
        }),
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
      // Back to `ready` whatever happened, so the next message can be sent.
      inFlight.current = false;
      setLoading(false);
    }
  }

  const handler: ChatHandler = {
    messages: chatUIMessages,
    status: loading ? 'submitted' : 'ready',
    sendMessage: async (msg) => {
      const text = msg.parts
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('\n')
        .trim();
      if (!text || inFlight.current) return;
      inFlight.current = true;
      await send(text);
    },
  };

  return { handler, addAssistantNote, isEmpty: messages.length === 0 };
}

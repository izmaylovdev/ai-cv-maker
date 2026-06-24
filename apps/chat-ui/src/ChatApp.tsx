import { useState, useRef, useEffect, useCallback } from 'react';
import { MessageList } from './components/MessageList';
import { MessageInput } from './components/MessageInput';
import './ChatApp.css';

const MAX_HISTORY_TURNS = 20;

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'error';
  content: string;
}

// US-AI-9 §6.3 — an edit the assistant proposes against the open document.
export interface ChatEdit {
  patchJson: string;
  description: string;
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
  /** Called when the assistant returns an edit to apply to {@link document}. */
  onEdit?: (edit: ChatEdit) => void;
  /** Exposes an imperative API to the host (e.g. to append a note to the thread). */
  onReady?: (api: ChatApi) => void;
}

export interface ChatApi {
  /** Append an assistant-authored note to the thread (e.g. a rejected edit). */
  addAssistantNote: (text: string) => void;
}

export function ChatApp({ authToken, apiBase, document, onEdit, onReady }: Props) {
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
        // `document` is sent only in edit mode (in-editor chat). Omitted → the
        // backend handles the message with the global read-only assistant.
        body: JSON.stringify(document ? { message: text, history, document } : { message: text, history }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: data.reply,
      };
      setMessages((prev) => [...prev, assistantMsg]);

      // Edit mode: hand any proposed edit to the host to apply to the document.
      if (data.proposal && onEdit) {
        onEdit({
          patchJson: data.proposal.patchJson ?? data.proposal.patch_json ?? '',
          description: data.proposal.description ?? '',
        });
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: 'error', content: 'Something went wrong. Please try again.' },
      ]);
    } finally {
      setLoading(false);
    }
  }

  const isEmpty = messages.length === 0;

  return (
    <div className={`chat-app${isEmpty ? ' chat-app--empty' : ''}`}>
      {isEmpty ? (
        <div className="chat-landing">
          <div className="chat-landing__heading">How can I help you?</div>
          <MessageInput onSend={send} disabled={loading} landing />
        </div>
      ) : (
        <>
          <div className="chat-messages">
            <MessageList messages={messages} />
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

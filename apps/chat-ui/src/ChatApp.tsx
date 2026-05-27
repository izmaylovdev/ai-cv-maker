import { useState, useRef, useEffect } from 'react';
import { MessageList } from './components/MessageList';
import { MessageInput } from './components/MessageInput';
import './ChatApp.css';

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'error';
  content: string;
}

interface Props {
  authToken: string;
  apiBase: string;
}

export function ChatApp({ authToken, apiBase }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function send(text: string) {
    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', content: text };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    const history = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role, content: m.content }));

    try {
      const res = await fetch(`${apiBase}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ message: text, history }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: data.reply,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: 'error', content: 'Something went wrong. Please try again.' },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="chat-app">
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
    </div>
  );
}

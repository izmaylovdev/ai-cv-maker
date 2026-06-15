import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Message } from '../ChatApp';

interface Props {
  messages: Message[];
}

export function MessageList({ messages }: Props) {
  if (messages.length === 0) {
    return (
      <div className="chat-empty">
        Ask me anything about your career, profiles, or how to improve your CV.
      </div>
    );
  }

  return (
    <>
      {messages.map((msg) => (
        <div key={msg.id} className={`chat-message chat-message--${msg.role}`}>
          {msg.role === 'assistant' ? (
            <div className="chat-message__text chat-markdown">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                // Raw HTML is not parsed by react-markdown's default pipeline,
                // so assistant content cannot inject active markup (F-CHAT-5.6).
                components={{
                  // Links open in a new tab without leaking the referrer (F-CHAT-5.7).
                  a: ({ node: _node, ...props }) => (
                    <a {...props} target="_blank" rel="noopener noreferrer" />
                  ),
                }}
              >
                {msg.content}
              </ReactMarkdown>
            </div>
          ) : (
            // user / error messages are literal text with newlines preserved
            // (white-space: pre-wrap on .chat-message__text) — F-CHAT-5.4.
            <p className="chat-message__text">{msg.content}</p>
          )}
        </div>
      ))}
    </>
  );
}

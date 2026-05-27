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
          <p className="chat-message__text">{msg.content}</p>
        </div>
      ))}
    </>
  );
}

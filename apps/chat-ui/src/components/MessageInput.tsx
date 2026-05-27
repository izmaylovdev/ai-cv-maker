import { useState, type KeyboardEvent } from 'react';

interface Props {
  onSend: (text: string) => void;
  disabled: boolean;
}

export function MessageInput({ onSend, disabled }: Props) {
  const [value, setValue] = useState('');

  function submit() {
    const text = value.trim();
    if (!text || disabled) return;
    onSend(text);
    setValue('');
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="chat-input">
      <textarea
        className="chat-input__textarea"
        placeholder="Ask a question or give an instruction…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        disabled={disabled}
        rows={2}
      />
      <button
        className="chat-input__send"
        onClick={submit}
        disabled={disabled || !value.trim()}
        aria-label="Send"
      >
        Send
      </button>
    </div>
  );
}

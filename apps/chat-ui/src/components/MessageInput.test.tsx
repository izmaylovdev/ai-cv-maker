import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MessageInput } from './MessageInput';

// jsdom does not lay out elements, so scrollHeight is always 0. Stub it so the
// auto-grow logic has a non-trivial value to react to.
function stubScrollHeight(px: number) {
  Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', {
    configurable: true,
    get: () => px,
  });
}

beforeEach(() => {
  stubScrollHeight(120);
});

describe('MessageInput — submit behaviour (F-CHAT-5.2)', () => {
  it('Enter (no shift) sends the trimmed message', () => {
    const onSend = vi.fn();
    render(<MessageInput onSend={onSend} disabled={false} />);
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;

    fireEvent.change(ta, { target: { value: '  hello  ' } });
    fireEvent.keyDown(ta, { key: 'Enter', shiftKey: false });

    expect(onSend).toHaveBeenCalledWith('hello');
  });

  it('Shift+Enter does NOT send (inserts a newline instead)', () => {
    const onSend = vi.fn();
    render(<MessageInput onSend={onSend} disabled={false} />);
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;

    fireEvent.change(ta, { target: { value: 'line one' } });
    fireEvent.keyDown(ta, { key: 'Enter', shiftKey: true });

    expect(onSend).not.toHaveBeenCalled();
  });
});

describe('MessageInput — auto-grow (F-CHAT-5.1, F-CHAT-5.3)', () => {
  it('grows the textarea height to fit its content', () => {
    render(<MessageInput onSend={vi.fn()} disabled={false} />);
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;

    fireEvent.change(ta, { target: { value: 'a\nb\nc\nd' } });

    expect(ta.style.height).toBe('120px');
  });

  it('resets the textarea height after sending', () => {
    const onSend = vi.fn();
    render(<MessageInput onSend={onSend} disabled={false} />);
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;

    fireEvent.change(ta, { target: { value: 'a\nb\nc\nd' } });
    expect(ta.style.height).toBe('120px');

    fireEvent.keyDown(ta, { key: 'Enter', shiftKey: false });

    // Value cleared and height collapsed back to the single-row baseline.
    expect(ta.value).toBe('');
    expect(ta.style.height).toBe('auto');
  });
});

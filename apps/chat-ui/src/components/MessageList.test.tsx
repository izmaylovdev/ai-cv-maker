import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MessageList } from './MessageList';
import type { Message } from '../ChatApp';

function msg(partial: Partial<Message>): Message {
  return { id: crypto.randomUUID(), role: 'assistant', content: '', ...partial };
}

describe('MessageList — assistant Markdown rendering (F-CHAT-5.5)', () => {
  it('renders bold, lists, and inline code as real elements', () => {
    render(
      <MessageList
        messages={[
          msg({
            role: 'assistant',
            content: 'Here is **bold** text and `code`.\n\n- first\n- second',
          }),
        ]}
      />
    );

    expect(screen.getByText('bold').tagName).toBe('STRONG');
    expect(screen.getByText('code').tagName).toBe('CODE');
    const items = screen.getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual(['first', 'second']);
  });

  it('renders fenced code blocks (F-CHAT-5.5)', () => {
    render(
      <MessageList
        messages={[msg({ role: 'assistant', content: '```\nconst x = 1;\n```' })]}
      />
    );
    expect(screen.getByText(/const x = 1;/)).toBeTruthy();
  });

  it('opens Markdown links in a new tab safely (F-CHAT-5.7)', () => {
    render(
      <MessageList
        messages={[
          msg({ role: 'assistant', content: '[example](https://example.com)' }),
        ]}
      />
    );
    const link = screen.getByRole('link', { name: 'example' }) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('https://example.com');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(link.getAttribute('rel')).toContain('noreferrer');
  });

  it('does not execute raw HTML embedded in assistant content (F-CHAT-5.6)', () => {
    const { container } = render(
      <MessageList
        messages={[
          msg({
            role: 'assistant',
            content: 'safe <img src=x onerror="alert(1)"> text',
          }),
        ]}
      />
    );
    // Raw HTML must be dropped, not parsed into a live element.
    expect(container.querySelector('img')).toBeNull();
  });
});

describe('MessageList — user/error newline preservation (F-CHAT-5.4)', () => {
  it('renders user content as literal text (no Markdown parsing) preserving newlines', () => {
    render(
      <MessageList
        messages={[msg({ role: 'user', content: 'line one\nline two with **stars**' })]}
      />
    );
    // The asterisks stay literal for user messages.
    const text = screen.getByText(/line two with \*\*stars\*\*/);
    expect(text).toBeTruthy();
    // Newline is preserved via the raw text node, not collapsed away.
    expect(text.textContent).toContain('line one\nline two');
  });

  it('renders error content as literal text', () => {
    render(
      <MessageList messages={[msg({ role: 'error', content: 'oops\nretry' })]} />
    );
    const el = screen.getByText(/oops/);
    expect(el.textContent).toContain('oops\nretry');
  });
});

describe('MessageList — empty state', () => {
  it('shows the empty prompt when there are no messages', () => {
    render(<MessageList messages={[]} />);
    expect(screen.getByText(/Ask me anything/i)).toBeTruthy();
  });
});

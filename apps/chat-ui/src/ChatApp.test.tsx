import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ChatApp } from './ChatApp';

// US-AI-9 §6.3 — when the in-editor chat is given the open `document`, it sends it
// as context with each message and surfaces any returned edit via `onEdit`.

const DOC = {
  header: { fullName: 'Jane', title: 'Engineer', email: '', phone: '', location: '' },
  body: { type: 'root', id: 'root-1', children: [] },
};

async function sendMessage(text: string) {
  const input = screen.getByRole('textbox');
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
}

function mockFetchOnce(json: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => json,
  } as Response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('ChatApp — in-editor editing', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // jsdom does not implement scrollIntoView (ChatApp calls it on each message).
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('includes the open document in the request body when provided', async () => {
    const fetchMock = mockFetchOnce({ reply: 'ok', proposal: null });

    render(<ChatApp authToken="t" apiBase="/api" document={DOC} onEdit={vi.fn()} />);
    await sendMessage('turn my skills into chips');

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.message).toBe('turn my skills into chips');
    expect(body.document).toEqual(DOC);
  });

  it('does not send a document on the global (read-only) chat', async () => {
    const fetchMock = mockFetchOnce({ reply: 'ok', proposal: null });

    render(<ChatApp authToken="t" apiBase="/api" />);
    await sendMessage('what skills do I have?');

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.document).toBeUndefined();
  });

  it('calls onEdit with the patch when the response includes a proposal', async () => {
    const proposal = {
      type: 'edit',
      description: 'Convert Skills list to chips',
      patchJson: '{"ops":[{"op":"convertNode","id":"list-1","to":"chips"}]}',
    };
    mockFetchOnce({ reply: 'Done.', proposal });
    const onEdit = vi.fn();

    render(<ChatApp authToken="t" apiBase="/api" document={DOC} onEdit={onEdit} />);
    await sendMessage('turn my skills list into chips');

    await waitFor(() => expect(onEdit).toHaveBeenCalledTimes(1));
    expect(onEdit).toHaveBeenCalledWith({
      patchJson: proposal.patchJson,
      description: proposal.description,
    });
    // The reply is still shown in the thread.
    expect(await screen.findByText('Done.')).toBeTruthy();
  });

  it('does not call onEdit for a plain answer (no proposal)', async () => {
    mockFetchOnce({ reply: 'You have Python and Go.', proposal: null });
    const onEdit = vi.fn();

    render(<ChatApp authToken="t" apiBase="/api" document={DOC} onEdit={onEdit} />);
    await sendMessage('what skills do I have?');

    expect(await screen.findByText('You have Python and Go.')).toBeTruthy();
    expect(onEdit).not.toHaveBeenCalled();
  });
});

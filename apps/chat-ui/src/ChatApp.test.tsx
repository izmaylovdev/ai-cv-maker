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

  it('includes the open profileId so cross-profile reads exclude it (US-AI-13)', async () => {
    const fetchMock = mockFetchOnce({ reply: 'ok', proposal: null });

    render(
      <ChatApp authToken="t" apiBase="/api" document={DOC} profileId="prof-42" onEdit={vi.fn()} />,
    );
    await sendMessage('populate this from my other profile');

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.profileId).toBe('prof-42');
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

// US-EXT-4 — the side-panel (extension) chat is given the current page's job
// posting as `jobContext` and can return a `fill` proposal: a cover-letter draft
// shown in the thread with a "Use this" button. Accepting it calls `onFill`
// (which the extension forwards to the page); nothing is written automatically.
describe('ChatApp — job-context chat & accept-to-fill (US-EXT-4)', () => {
  const JOB = {
    jobTitle: 'Senior Engineer',
    jobDescription: 'Build great things with TypeScript and Go.',
    fieldContext: 'cover letter',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends jobContext (and no document) in the request body when provided', async () => {
    const fetchMock = mockFetchOnce({ reply: 'Sure.', proposal: null });

    render(<ChatApp authToken="t" apiBase="/api" jobContext={JOB} onFill={vi.fn()} />);
    await sendMessage('what does this role need?');

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.jobContext).toEqual(JOB);
    expect(body.document).toBeUndefined();
  });

  it('renders a "Use this" action for a fill proposal without auto-firing onFill', async () => {
    const proposal = { type: 'fill', description: 'Cover letter draft', text: 'Dear Hiring Manager, …' };
    mockFetchOnce({ reply: "Here's a draft:", proposal });
    const onFill = vi.fn();

    render(<ChatApp authToken="t" apiBase="/api" jobContext={JOB} onFill={onFill} />);
    await sendMessage('write me a cover letter');

    // The reply is shown; nothing is filled until the user accepts.
    expect(await screen.findByText("Here's a draft:")).toBeTruthy();
    const useBtn = await screen.findByRole('button', { name: /use this/i });
    expect(onFill).not.toHaveBeenCalled();

    fireEvent.click(useBtn);
    expect(onFill).toHaveBeenCalledTimes(1);
    expect(onFill).toHaveBeenCalledWith({ text: proposal.text });
  });

  it('does not treat a fill proposal as an edit (onEdit is never called)', async () => {
    const proposal = { type: 'fill', description: 'Cover letter draft', text: 'Dear …' };
    mockFetchOnce({ reply: 'Draft ready.', proposal });
    const onEdit = vi.fn();
    const onFill = vi.fn();

    render(<ChatApp authToken="t" apiBase="/api" jobContext={JOB} onEdit={onEdit} onFill={onFill} />);
    await sendMessage('cover letter please');

    expect(await screen.findByRole('button', { name: /use this/i })).toBeTruthy();
    expect(onEdit).not.toHaveBeenCalled();
  });
});

// US-AI-12 — the in-editor chat (rendered with a `document`) opens directly in
// the conversation layout: an empty thread with a greeting hint and the input
// anchored at the bottom, never the centered "How can I help you?" landing
// splash. The global assistant (no `document`) keeps the landing splash.
describe('ChatApp — empty-state layout (US-AI-12)', () => {
  const LANDING = /how can i help you\?/i;
  const GREETING = /ask me to edit your cv/i;

  beforeEach(() => {
    vi.restoreAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('in-editor empty state shows the greeting hint and input, not the landing splash', () => {
    render(<ChatApp authToken="t" apiBase="/api" document={DOC} onEdit={vi.fn()} />);

    // F-AI-12.1 / F-AI-12.4 — no centered landing splash for the in-editor chat.
    expect(screen.queryByText(LANDING)).toBeNull();
    // F-AI-12.2 — a muted greeting hint is shown in the empty thread.
    expect(screen.getByText(GREETING)).toBeTruthy();
    // The message input is present and usable from the empty state.
    expect(screen.getByRole('textbox')).toBeTruthy();
  });

  it('global (no document) empty state still shows the landing splash', () => {
    render(<ChatApp authToken="t" apiBase="/api" />);

    // F-AI-12.4 — the global assistant keeps its centered landing.
    expect(screen.getByText(LANDING)).toBeTruthy();
    expect(screen.queryByText(GREETING)).toBeNull();
  });

  it('greeting disappears once a message is sent, input stays available', async () => {
    mockFetchOnce({ reply: 'Done.', proposal: null });

    render(<ChatApp authToken="t" apiBase="/api" document={DOC} onEdit={vi.fn()} />);
    expect(screen.getByText(GREETING)).toBeTruthy();

    await sendMessage('add a skill');

    // F-AI-12.3 — after the first message the greeting is gone, input remains.
    expect(await screen.findByText('add a skill')).toBeTruthy();
    expect(screen.queryByText(GREETING)).toBeNull();
    expect(screen.getByRole('textbox')).toBeTruthy();
  });
});

// US-AI-11 / F-AI-11.7-11.8 — the widget renders the server-provided error
// message verbatim, falls back to a single generic line only when the body is
// unreadable, and stays usable after a failure.
describe('ChatApp — specific error messages (US-AI-11)', () => {
  const GENERIC = /something went wrong/i;

  beforeEach(() => {
    vi.restoreAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockFetchSequence(...responses: Array<Partial<Response> & { json: () => Promise<unknown> }>) {
    const fetchMock = vi.fn();
    for (const r of responses) fetchMock.mockResolvedValueOnce(r as Response);
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  function errorResponse(status: number, body: unknown) {
    return { ok: false, status, json: async () => body } as Partial<Response> & {
      json: () => Promise<unknown>;
    };
  }

  it('renders the server-provided error message, not the generic one', async () => {
    const message =
      "I couldn't produce a valid edit for that — my response may have been too long. Try a smaller change.";
    mockFetchSequence(errorResponse(502, { code: 'llm_edit_failed', message }));

    render(<ChatApp authToken="t" apiBase="/api" document={DOC} />);
    await sendMessage('rewrite my entire profile in extreme detail');

    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.queryByText(GENERIC)).toBeNull();
  });

  it('surfaces a usage-limit message distinctly', async () => {
    const message = "You've reached your AI usage limit.";
    mockFetchSequence(errorResponse(402, { code: 'usage_limit_exceeded', message }));

    render(<ChatApp authToken="t" apiBase="/api" document={DOC} />);
    await sendMessage('add a skill');

    expect(await screen.findByText(message)).toBeTruthy();
  });

  it('falls back to a generic message when the error body is unparseable', async () => {
    mockFetchSequence({
      ok: false,
      status: 500,
      json: async () => {
        throw new SyntaxError('Unexpected end of JSON input');
      },
    } as Partial<Response> & { json: () => Promise<unknown> });

    render(<ChatApp authToken="t" apiBase="/api" document={DOC} />);
    await sendMessage('hello');

    expect(await screen.findByText(GENERIC)).toBeTruthy();
  });

  it('stays usable after a failure — a later message still works', async () => {
    mockFetchSequence(
      errorResponse(503, { code: 'llm_unavailable', message: 'The AI service is temporarily unavailable.' }),
      { ok: true, status: 200, json: async () => ({ reply: 'Done!' }) } as Partial<Response> & {
        json: () => Promise<unknown>;
      },
    );

    render(<ChatApp authToken="t" apiBase="/api" document={DOC} />);
    await sendMessage('first try');
    expect(await screen.findByText('The AI service is temporarily unavailable.')).toBeTruthy();

    await sendMessage('second try');
    expect(await screen.findByText('Done!')).toBeTruthy();
  });
});

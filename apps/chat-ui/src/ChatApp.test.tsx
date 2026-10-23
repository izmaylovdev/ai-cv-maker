import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { ChatApp, type ChatApi } from './ChatApp';

// The widget's thread and composer are built on LlamaIndex Chat UI. These tests
// assert on roles, text and the DOM Chat UI really renders (a <form> with a
// submit button around the textarea, highlight.js markup in code blocks) — never
// on Applysy-specific CSS class names.

const DOC = {
  header: { fullName: 'Jane', title: 'Engineer', email: '', phone: '', location: '' },
  body: { type: 'root', id: 'root-1', children: [] },
};

type FakeResponse = Partial<Response> & { json: () => Promise<unknown> };

function typeInto(text: string) {
  const input = screen.getByRole('textbox');
  fireEvent.change(input, { target: { value: text } });
  return input as HTMLTextAreaElement;
}

async function sendMessage(text: string) {
  const input = typeInto(text);
  fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
}

/** The Chat UI composer: the textbox, its enclosing <form>, and that form's submit button. */
function composer() {
  const input = screen.getByRole('textbox') as HTMLTextAreaElement;
  const form = input.closest('form');
  const submit = (form?.querySelector('button[type="submit"]') ?? null) as HTMLButtonElement | null;
  return { input, form, submit };
}

function okResponse(json: unknown): FakeResponse {
  return { ok: true, status: 200, json: async () => json };
}

function errorResponse(status: number, body: unknown): FakeResponse {
  return { ok: false, status, json: async () => body };
}

function mockFetchOnce(json: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(okResponse(json) as Response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function mockFetchSequence(...responses: FakeResponse[]) {
  const fetchMock = vi.fn();
  for (const r of responses) fetchMock.mockResolvedValueOnce(r as Response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** A fetch whose single response stays pending until `resolve` is called. */
function mockPendingFetch() {
  let resolve!: (r: FakeResponse) => void;
  const pending = new Promise<FakeResponse>((r) => {
    resolve = r;
  });
  const fetchMock = vi.fn().mockReturnValue(pending);
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, resolve };
}

function bodyOf(fetchMock: ReturnType<typeof vi.fn>, call: number) {
  return JSON.parse((fetchMock.mock.calls[call][1] as RequestInit).body as string);
}

beforeEach(() => {
  vi.restoreAllMocks();
  // jsdom does not implement scrollIntoView.
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// US-AI-9 §6.3 — when the in-editor chat is given the open `document`, it sends it
// as context with each message and surfaces any returned edit via `onEdit`.
describe('ChatApp — in-editor editing', () => {
  it('includes the open document in the request body when provided', async () => {
    const fetchMock = mockFetchOnce({ reply: 'ok', proposal: null });

    render(<ChatApp authToken="t" apiBase="/api" document={DOC} onEdit={vi.fn()} />);
    await sendMessage('turn my skills into chips');

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe('/api/chat');
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer t');
    const body = bodyOf(fetchMock, 0);
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
    const body = bodyOf(fetchMock, 0);
    expect(body.profileId).toBe('prof-42');
    expect(body.document).toEqual(DOC);
  });

  it('does not send a document on the global (read-only) chat', async () => {
    const fetchMock = mockFetchOnce({ reply: 'ok', proposal: null });

    render(<ChatApp authToken="t" apiBase="/api" />);
    await sendMessage('what skills do I have?');

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(bodyOf(fetchMock, 0).document).toBeUndefined();
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

  // F-CHAT-6.10 — the host reports a rejected patch back into the thread through
  // the imperative api handed out via `onReady`.
  it('addAssistantNote(text) appends an assistant message with that text', async () => {
    let api: ChatApi | undefined;
    render(
      <ChatApp authToken="t" apiBase="/api" document={DOC} onReady={(a) => (api = a)} />,
    );
    await waitFor(() => expect(api).toBeDefined());

    act(() => api!.addAssistantNote("I couldn't apply that edit — the section no longer exists."));

    expect(
      await screen.findByText("I couldn't apply that edit — the section no longer exists."),
    ).toBeTruthy();
    // It is an assistant message: rendered through the assistant Markdown pipeline.
    act(() => api!.addAssistantNote('**Rejected** edit'));
    expect((await screen.findByText('Rejected')).tagName).toBe('STRONG');
    // A note is not an error.
    expect(screen.queryByRole('alert')).toBeNull();
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

  it('sends jobContext (and no document) in the request body when provided', async () => {
    const fetchMock = mockFetchOnce({ reply: 'Sure.', proposal: null });

    render(<ChatApp authToken="t" apiBase="/api" jobContext={JOB} onFill={vi.fn()} />);
    await sendMessage('what does this role need?');

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = bodyOf(fetchMock, 0);
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

  it('a plain reply (no fill proposal) has no "Use this" action', async () => {
    mockFetchOnce({ reply: 'It needs Go.', proposal: null });

    render(<ChatApp authToken="t" apiBase="/api" jobContext={JOB} onFill={vi.fn()} />);
    await sendMessage('what does this role need?');

    expect(await screen.findByText('It needs Go.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /use this/i })).toBeNull();
  });
});

// US-AI-12 — the in-editor chat (rendered with a `document`) opens directly in
// the conversation layout: an empty thread with a greeting hint and the input
// anchored at the bottom, never the centered "How can I help you?" landing
// splash. The global assistant (no `document`) keeps the landing splash.
describe('ChatApp — empty-state layout (US-AI-12)', () => {
  const LANDING = /how can i help you\?/i;
  const GREETING = /ask me to edit your cv/i;

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
    expect(screen.getByRole('textbox')).toBeTruthy();
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

  it('landing disappears once the first message is sent on the global chat', async () => {
    mockFetchOnce({ reply: 'Hi there.', proposal: null });

    render(<ChatApp authToken="t" apiBase="/api" />);
    await sendMessage('hello');

    expect(await screen.findByText('Hi there.')).toBeTruthy();
    expect(screen.queryByText(LANDING)).toBeNull();
    expect(screen.getByRole('textbox')).toBeTruthy();
  });
});

// The composer is Chat UI's input form: a textarea plus a submit (send) button
// inside a <form>, on both the global landing and the in-editor layout.
describe('ChatApp — Chat UI composer', () => {
  it.each([
    ['global landing', {}],
    ['in-editor', { document: DOC }],
  ])('renders a form with a textbox and a send (submit) button — %s', (_label, extra) => {
    render(<ChatApp authToken="t" apiBase="/api" {...extra} />);

    const { input, form, submit } = composer();
    expect(input.tagName).toBe('TEXTAREA');
    expect(form).not.toBeNull();
    expect(submit).not.toBeNull();
  });

  it('Enter sends the message', async () => {
    const fetchMock = mockFetchOnce({ reply: 'ok', proposal: null });

    render(<ChatApp authToken="t" apiBase="/api" document={DOC} />);
    await sendMessage('hello there');

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(bodyOf(fetchMock, 0).message).toBe('hello there');
    // The composer is cleared after sending.
    expect(composer().input.value).toBe('');
  });

  it('Shift+Enter does not send (it inserts a newline instead)', async () => {
    const fetchMock = mockFetchOnce({ reply: 'ok', proposal: null });

    render(<ChatApp authToken="t" apiBase="/api" document={DOC} />);
    const input = typeInto('line one');
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', shiftKey: true });

    // Give any (wrongly) triggered async send a chance to run.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(input.value).toBe('line one');
  });

  it('Enter never inserts a newline while sending is disabled (empty input)', async () => {
    const fetchMock = mockFetchOnce({ reply: 'ok', proposal: null });

    render(<ChatApp authToken="t" apiBase="/api" document={DOC} />);
    const input = composer().input!;
    // fireEvent returns false when the handler called preventDefault().
    const notPrevented = fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    expect(notPrevented).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('clicking the send button sends the message', async () => {
    const fetchMock = mockFetchOnce({ reply: 'ok', proposal: null });

    render(<ChatApp authToken="t" apiBase="/api" document={DOC} />);
    typeInto('via the button');
    fireEvent.click(composer().submit!);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(bodyOf(fetchMock, 0).message).toBe('via the button');
  });

  it('the send button is disabled on empty / whitespace-only input and enabled once there is text', () => {
    render(<ChatApp authToken="t" apiBase="/api" document={DOC} />);

    expect(composer().submit!.disabled).toBe(true);
    typeInto('   ');
    expect(composer().submit!.disabled).toBe(true);
    typeInto('hi');
    expect(composer().submit!.disabled).toBe(false);
  });

  it('while a reply is in flight: send is disabled, a loading indicator shows, Enter does not resend', async () => {
    const { fetchMock, resolve } = mockPendingFetch();

    const { container } = render(<ChatApp authToken="t" apiBase="/api" document={DOC} />);
    await sendMessage('slow question');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // Chat UI's in-flight indicator (ChatMessages.Loading → spinning loader).
    await waitFor(() => expect(container.querySelector('.animate-spin')).not.toBeNull());

    // Even with text in the composer, sending is blocked until the reply lands.
    const input = typeInto('follow-up');
    expect(composer().submit!.disabled).toBe(true);
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolve(okResponse({ reply: 'Finally.', proposal: null }));
    });

    expect(await screen.findByText('Finally.')).toBeTruthy();
    await waitFor(() => expect(container.querySelector('.animate-spin')).toBeNull());
    expect(composer().submit!.disabled).toBe(false);
  });

  // F-CHAT-5.1 / F-CHAT-5.3 — the textarea grows with its content (up to a max
  // height) and collapses back after sending.
  describe('auto-grow', () => {
    const original = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'scrollHeight');
    beforeEach(() => {
      // jsdom does not lay out elements, so scrollHeight is always 0.
      Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', {
        configurable: true,
        get: () => 120,
      });
    });
    afterEach(() => {
      if (original) Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', original);
      else delete (HTMLTextAreaElement.prototype as unknown as Record<string, unknown>).scrollHeight;
    });

    it('grows the textarea to fit its content and collapses it after sending', async () => {
      mockFetchOnce({ reply: 'ok', proposal: null });
      render(<ChatApp authToken="t" apiBase="/api" document={DOC} />);

      const input = typeInto('a\nb\nc\nd');
      const grown = input.style.height;
      expect(grown).toMatch(/px$/);
      expect(parseFloat(grown)).toBeGreaterThanOrEqual(120);

      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
      await screen.findByText('ok');

      expect(input.value).toBe('');
      expect(input.style.height).not.toBe(grown);
    });
  });
});

// The thread keeps the newest message in view.
describe('ChatApp — auto-scroll', () => {
  const originalScrollTop = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTop');
  const originalScrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
  let scrollTopWrites: number[];

  beforeEach(() => {
    scrollTopWrites = [];
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get: () => 987,
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
      configurable: true,
      get: () => 0,
      set: (v: number) => {
        scrollTopWrites.push(v);
      },
    });
  });
  afterEach(() => {
    const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
    if (originalScrollTop) Object.defineProperty(HTMLElement.prototype, 'scrollTop', originalScrollTop);
    else delete proto.scrollTop;
    if (originalScrollHeight) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', originalScrollHeight);
    else delete proto.scrollHeight;
  });

  it('scrolls the thread to the newest message when a reply arrives', async () => {
    mockFetchOnce({ reply: 'Newest reply.', proposal: null });
    render(<ChatApp authToken="t" apiBase="/api" document={DOC} />);

    scrollTopWrites = [];
    (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mockClear();
    await sendMessage('scroll me');
    expect(await screen.findByText('Newest reply.')).toBeTruthy();

    // Either mechanism keeps the newest message in view: the scroll container is
    // pinned to its bottom, or the last element is scrolled into view.
    const scrolledToBottom = scrollTopWrites.includes(987);
    const scrolledIntoView = (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mock.calls.length > 0;
    expect(scrolledToBottom || scrolledIntoView).toBe(true);
  });
});

// User and assistant messages are rendered differently: user text is literal,
// assistant replies are GitHub-flavored Markdown.
describe('ChatApp — message rendering', () => {
  async function renderReply(reply: string) {
    mockFetchOnce({ reply, proposal: null });
    const utils = render(<ChatApp authToken="t" apiBase="/api" document={DOC} />);
    await sendMessage('question');
    await screen.findByText('question');
    return utils;
  }

  it('renders user content as literal text (no Markdown parsing), preserving newlines', async () => {
    mockFetchOnce({ reply: 'ok', proposal: null });
    render(<ChatApp authToken="t" apiBase="/api" document={DOC} />);
    await sendMessage('line one\nline two with **stars**');

    const text = await screen.findByText(/line two with \*\*stars\*\*/);
    expect(text.textContent).toContain('line one\nline two');
  });

  it('renders bold, inline code and lists in a reply as real elements', async () => {
    await renderReply('Here is **bold** text and `code`.\n\n- first\n- second');

    expect((await screen.findByText('bold')).tagName).toBe('STRONG');
    expect(screen.getByText('code').tagName).toBe('CODE');
    const items = screen.getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual(['first', 'second']);
  });

  it('renders a GFM table in a reply as a table', async () => {
    await renderReply('| Skill | Years |\n| --- | --- |\n| Go | 5 |\n| Python | 7 |');

    const table = await screen.findByRole('table');
    expect(table.tagName).toBe('TABLE');
    expect(screen.getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Skill', 'Years']);
    expect(screen.getByRole('cell', { name: 'Python' })).toBeTruthy();
  });

  it('opens Markdown links in a new tab with rel="noopener noreferrer"', async () => {
    await renderReply('See [example](https://example.com) for details.');

    const link = (await screen.findByRole('link', { name: 'example' })) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('https://example.com');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(link.getAttribute('rel')).toContain('noreferrer');
  });

  it('shows raw HTML in a reply as text, never as live markup', async () => {
    const { container } = await renderReply('safe <img src=x onerror="alert(1)"> text');

    await screen.findByText(/safe/);
    expect(container.querySelector('img')).toBeNull();
    // The raw HTML is visible as literal text.
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">');
  });

  it('syntax-highlights fenced code blocks with highlight.js', async () => {
    const { container } = await renderReply('```js\nconst answer = 42;\nfunction f() { return answer; }\n```');

    await waitFor(() => expect(container.textContent).toContain('const answer = 42;'));
    await waitFor(() => {
      const highlighted =
        container.querySelector('code.hljs') ?? container.querySelector('[class*="hljs-"]');
      expect(highlighted).not.toBeNull();
    });
    // Token spans are produced (e.g. hljs-keyword for `const` / `function`).
    expect(container.querySelector('.hljs-keyword')).not.toBeNull();
  });

  it('does not treat dollar amounts as math', async () => {
    const { container } = await renderReply('The range is $120k to $150k per year.');

    await waitFor(() => expect(container.textContent).toContain('$120k to $150k'));
    expect(container.querySelector('.katex')).toBeNull();
  });
});

// US-AI-16 — the widget mints one sessionId per mount and sends it on every
// POST /chat, so all messages within one open widget group under a single
// Langfuse Session. A reload (fresh mount) starts a new Session.
describe('ChatApp — Langfuse session grouping (US-AI-16)', () => {
  // F-AI-16.1 — every request carries a non-empty string sessionId.
  it('includes a non-empty string sessionId in the request body', async () => {
    const fetchMock = mockFetchOnce({ reply: 'ok', proposal: null });

    render(<ChatApp authToken="t" apiBase="/api" />);
    await sendMessage('hello');

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = bodyOf(fetchMock, 0);
    expect(typeof body.sessionId).toBe('string');
    expect(body.sessionId.length).toBeGreaterThan(0);
  });

  // F-AI-16.1 — two messages within one mount share the SAME sessionId.
  it('sends the same sessionId for two messages within one mount', async () => {
    const fetchMock = mockFetchSequence(
      okResponse({ reply: 'first reply', proposal: null }),
      okResponse({ reply: 'second reply', proposal: null }),
    );

    render(<ChatApp authToken="t" apiBase="/api" />);
    await sendMessage('first');
    await screen.findByText('first reply');
    await sendMessage('second');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const first = bodyOf(fetchMock, 0);
    const second = bodyOf(fetchMock, 1);
    expect(first.sessionId).toBeTruthy();
    expect(second.sessionId).toBe(first.sessionId);
  });

  // F-AI-16.2 — a fresh mount (page reload) yields a DIFFERENT sessionId.
  it('mints a different sessionId on a fresh mount', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ reply: 'ok', proposal: null }) as Response);
    vi.stubGlobal('fetch', fetchMock);

    const first = render(<ChatApp authToken="t" apiBase="/api" />);
    await sendMessage('hello');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const firstSession = bodyOf(fetchMock, 0).sessionId;
    first.unmount();

    render(<ChatApp authToken="t" apiBase="/api" />);
    await sendMessage('hello again');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const secondSession = bodyOf(fetchMock, 1).sessionId;

    expect(firstSession).toBeTruthy();
    expect(secondSession).toBeTruthy();
    expect(secondSession).not.toBe(firstSession);
  });

  // F-AI-16.1 — the sessionId is present in edit mode too.
  it('includes the sessionId in edit mode (with a document)', async () => {
    const fetchMock = mockFetchOnce({ reply: 'ok', proposal: null });

    render(<ChatApp authToken="t" apiBase="/api" document={DOC} onEdit={vi.fn()} />);
    await sendMessage('add a skill');

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = bodyOf(fetchMock, 0);
    expect(body.document).toEqual(DOC);
    expect(typeof body.sessionId).toBe('string');
    expect(body.sessionId.length).toBeGreaterThan(0);
  });
});

// Conversation history sent to the API.
describe('ChatApp — request history', () => {
  it('sends prior user/assistant turns as history', async () => {
    const fetchMock = mockFetchSequence(
      okResponse({ reply: 'You have Go.', proposal: null }),
      okResponse({ reply: 'Sure.', proposal: null }),
    );

    render(<ChatApp authToken="t" apiBase="/api" document={DOC} />);
    await sendMessage('what skills do I have?');
    await screen.findByText('You have Go.');
    await sendMessage('add Rust');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(bodyOf(fetchMock, 0).history).toEqual([]);
    expect(bodyOf(fetchMock, 1).history).toEqual([
      { role: 'user', content: 'what skills do I have?' },
      { role: 'assistant', content: 'You have Go.' },
    ]);
  });

  it('caps history at the last 20 turns', async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const { message } = JSON.parse(init.body as string);
      return okResponse({ reply: `re: ${message}`, proposal: null }) as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ChatApp authToken="t" apiBase="/api" document={DOC} />);
    for (let i = 1; i <= 11; i++) {
      await sendMessage(`m${i}`);
      await screen.findByText(`re: m${i}`);
    }
    await sendMessage('m12');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(12));

    const history = bodyOf(fetchMock, 11).history as Array<{ role: string; content: string }>;
    expect(history).toHaveLength(20);
    // The oldest turn (m1 + its reply) is dropped; the newest is kept.
    expect(history[0]).toEqual({ role: 'user', content: 'm2' });
    expect(history[19]).toEqual({ role: 'assistant', content: 're: m11' });
  }, 20000);
});

// US-AI-11 / F-AI-11.7-11.8 — the widget renders the server-provided error
// message verbatim in a distinct error bubble (role="alert"), falls back to a
// single generic line only when the body is unreadable, and stays usable.
describe('ChatApp — error bubble (US-AI-11)', () => {
  const GENERIC = /something went wrong/i;

  it.each([
    [402, 'usage_limit_exceeded', "You've reached your AI usage limit."],
    [422, 'invalid_request', 'That request could not be processed.'],
    [429, 'rate_limited', 'Too many requests — please wait a moment.'],
    [502, 'llm_edit_failed', "I couldn't produce a valid edit for that — try a smaller change."],
    [503, 'llm_unavailable', 'The AI service is temporarily unavailable.'],
  ])('a %i response shows the server message in an error bubble (role="alert")', async (status, code, message) => {
    mockFetchSequence(errorResponse(status, { code, message }));

    render(<ChatApp authToken="t" apiBase="/api" document={DOC} />);
    await sendMessage('do something');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(message);
    expect(screen.queryByText(GENERIC)).toBeNull();
  });

  it('renders the server-provided error message, not the generic one', async () => {
    const message =
      "I couldn't produce a valid edit for that — my response may have been too long. Try a smaller change.";
    mockFetchSequence(errorResponse(502, { code: 'llm_edit_failed', message }));

    render(<ChatApp authToken="t" apiBase="/api" document={DOC} />);
    await sendMessage('rewrite my entire profile in extreme detail');

    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.queryByText(GENERIC)).toBeNull();
  });

  it('falls back to a generic message in the error bubble when the error body is unparseable', async () => {
    mockFetchSequence({
      ok: false,
      status: 500,
      json: async () => {
        throw new SyntaxError('Unexpected end of JSON input');
      },
    });

    render(<ChatApp authToken="t" apiBase="/api" document={DOC} />);
    await sendMessage('hello');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(GENERIC);
  });

  it('a network failure shows the generic message in the error bubble', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    render(<ChatApp authToken="t" apiBase="/api" document={DOC} />);
    await sendMessage('hello');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(GENERIC);
  });

  it('renders error text literally, preserving newlines', async () => {
    mockFetchSequence(errorResponse(502, { code: 'x', message: 'oops\nretry **later**' }));

    render(<ChatApp authToken="t" apiBase="/api" document={DOC} />);
    await sendMessage('hello');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('oops\nretry **later**');
  });

  it('stays usable after a failure — a later message still sends and its reply shows', async () => {
    mockFetchSequence(
      errorResponse(503, { code: 'llm_unavailable', message: 'The AI service is temporarily unavailable.' }),
      okResponse({ reply: 'Done!' }),
    );

    render(<ChatApp authToken="t" apiBase="/api" document={DOC} />);
    await sendMessage('first try');
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('The AI service is temporarily unavailable.')).toBeTruthy();
    await waitFor(() => expect(composer().submit).not.toBeNull());

    // The composer is usable again: send is enabled once text is typed.
    typeInto('second try');
    expect(composer().submit!.disabled).toBe(false);
    fireEvent.keyDown(composer().input, { key: 'Enter', code: 'Enter' });

    expect(await screen.findByText('Done!')).toBeTruthy();
    // The earlier error bubble remains in the thread.
    expect(screen.getByRole('alert').textContent).toContain('The AI service is temporarily unavailable.');
  });

  it('never includes error bubbles in the history of the next request', async () => {
    const fetchMock = mockFetchSequence(
      errorResponse(502, { code: 'llm_edit_failed', message: 'Edit failed upstream.' }),
      okResponse({ reply: 'ok', proposal: null }),
    );

    render(<ChatApp authToken="t" apiBase="/api" document={DOC} />);
    await sendMessage('first try');
    await screen.findByText('Edit failed upstream.');
    await sendMessage('second try');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const history = bodyOf(fetchMock, 1).history as Array<{ role: string; content: string }>;
    expect(history).toEqual([{ role: 'user', content: 'first try' }]);
    expect(history.some((h) => h.content.includes('Edit failed upstream.'))).toBe(false);
  });
});

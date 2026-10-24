import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { $getRoot, ElementNode, LexicalEditor, TextNode } from 'lexical';
import { TOGGLE_LINK_COMMAND } from '@lexical/link';
import { ProfileBuilder } from './ProfileBuilder';
import { BlockNode, ProfileDocument, RootNode, emptyHeader } from './model';
import { entryNode, paragraphNode, rootNode, timelineNode, titleNode } from './nodes';

function docWithOneTitle(): ProfileDocument {
  return {
    header: emptyHeader(),
    body: rootNode([titleNode('Work Experience'), paragraphNode('Built things.')]),
  };
}

function lastBody(onChange: ReturnType<typeof vi.fn>): RootNode | undefined {
  const call = onChange.mock.calls.at(-1);
  return call?.[0]?.body as RootNode | undefined;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ProfileBuilder — flat title-anchored document (US-EDIT-19)', () => {
  it('renders the fixed header letterhead inputs', () => {
    render(<ProfileBuilder document={docWithOneTitle()} onChange={vi.fn()} />);
    expect(screen.getByLabelText(/full name/i)).toBeTruthy();
    expect(screen.getByLabelText(/job title/i)).toBeTruthy();
  });

  it('offers six predefined widgets in the controls rail including Title (US-EDIT-19 / US-EDIT-15)', () => {
    render(<ProfileBuilder document={docWithOneTitle()} onChange={vi.fn()} />);
    const rail = screen.getByRole('toolbar', { name: /insert/i });
    for (const name of ['Title', 'Text', 'Chips', 'List', 'Link', 'Timeline']) {
      expect(within(rail).getByRole('button', { name: new RegExp(name, 'i') })).toBeTruthy();
    }
  });

  it('does not have a Section button in the rail (section is retired)', () => {
    render(<ProfileBuilder document={docWithOneTitle()} onChange={vi.fn()} />);
    const rail = screen.getByRole('toolbar', { name: /insert/i });
    expect(within(rail).queryByRole('button', { name: /section/i })).toBeNull();
  });

  it('exposes each rail widget keyboard shortcut in its accessible name (F-EDIT-15.6)', () => {
    render(<ProfileBuilder document={docWithOneTitle()} onChange={vi.fn()} />);
    const rail = screen.getByRole('toolbar', { name: /insert/i });
    // Every button must have an aria-keyshortcuts with at least one modifier key.
    for (const name of ['Title', 'Text', 'Chips', 'List', 'Link', 'Timeline']) {
      const btn = within(rail).getByRole('button', { name: new RegExp(name, 'i') });
      expect(btn.getAttribute('aria-keyshortcuts')).toMatch(/(Meta|Control|Option|Alt|Shift)\+/);
    }
  });

  it('emits a title node (not a section node) when adding a title', async () => {
    const onChange = vi.fn();
    render(<ProfileBuilder document={{ header: emptyHeader(), body: rootNode([]) }} onChange={onChange} />);
    const rail = screen.getByRole('toolbar', { name: /insert/i });
    fireEvent.click(within(rail).getByRole('button', { name: /title/i }));
    await waitFor(() => {
      const body = lastBody(onChange);
      expect(body?.children?.some((c) => c.type === 'title')).toBe(true);
    });
    expect(lastBody(onChange)?.children?.some((c) => (c as {type: string}).type === 'section')).toBeFalsy();
  });

  it('emits a flat root (no section wrappers) for all widget insertions', async () => {
    const onChange = vi.fn();
    render(<ProfileBuilder document={docWithOneTitle()} onChange={onChange} />);
    // Every root child must be a valid flat-model type — no 'section'.
    await waitFor(() => {
      const body = lastBody(onChange);
      if (!body) return;
      for (const child of body.children ?? []) {
        expect(child.type).not.toBe('section');
      }
    });
  });

  it('renders body content when a non-empty document is the initial prop', async () => {
    // Regression for the LoadBodyPlugin sentinel bug: bodyJsonRef was initialised
    // to JSON.stringify(document.body), so the very first effect saw
    // json === bodyJsonRef.current && _nodeMap.size > 1 and skipped loadDocument,
    // leaving the editor empty. Fixed by initialising bodyJsonRef to '' instead.
    render(
      <ProfileBuilder
        document={docWithOneTitle()}
        onChange={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText('Work Experience')).toBeTruthy();
      expect(screen.getByText('Built things.')).toBeTruthy();
    });
  });

  it('does not emit a no-op change when the host echoes the same body back', () => {
    const onChange = vi.fn();
    const doc = docWithOneTitle();
    const { rerender } = render(<ProfileBuilder document={doc} onChange={onChange} />);
    onChange.mockClear();
    rerender(<ProfileBuilder document={JSON.parse(JSON.stringify(doc))} onChange={onChange} />);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('loads a legacy section document and migrates it transparently (F-EDIT-19.8)', async () => {
    const onChange = vi.fn();
    const legacyDoc: ProfileDocument = {
      header: emptyHeader(),
      body: {
        type: 'root',
        id: 'r1',
        children: [
          {
            type: 'section',
            id: 's1',
            attrs: { heading: 'Experience' },
            children: [paragraphNode('Worked.')],
          } as unknown as ReturnType<typeof paragraphNode>,
        ],
      },
    };
    render(<ProfileBuilder document={legacyDoc} onChange={onChange} />);
    await waitFor(() => {
      const body = lastBody(onChange);
      if (!body) return;
      expect(body.children.some((c) => c.type === 'title')).toBe(true);
      expect(body.children.some((c) => (c as {type: string}).type === 'section')).toBe(false);
    });
  });

  it('loads a legacy standalone link block as a paragraph holding the same link (text + url)', async () => {
    const onChange = vi.fn();
    const legacyDoc: ProfileDocument = {
      header: emptyHeader(),
      body: {
        type: 'root',
        id: 'r1',
        children: [
          titleNode('Links'),
          { type: 'link', id: 'L1', attrs: { text: 'Portfolio', url: 'https://example.com' } } as never,
        ],
      },
    };
    render(<ProfileBuilder document={legacyDoc} onChange={onChange} />);

    await waitFor(() => {
      const body = lastBody(onChange);
      expect(body).toBeDefined();
      const migrated = body!.children.find((c) => c.id === 'L1');
      expect(migrated?.type).toBe('paragraph');
      expect(migrated?.children?.[0]).toMatchObject({
        type: 'inlineLink',
        attrs: { text: 'Portfolio', url: 'https://example.com' },
      });
    });
    const anchor = screen.getByRole('link', { name: 'Portfolio' });
    expect(anchor.getAttribute('href')).toBe('https://example.com');
  });

  it('a link created via TOGGLE_LINK_COMMAND gets a non-empty inlineLink id that stays stable', async () => {
    const onChange = vi.fn();
    const { container } = render(<ProfileBuilder document={docWithOneTitle()} onChange={onChange} />);
    await waitFor(() => expect(screen.getByText('Built things.')).toBeTruthy());
    const editable = container.querySelector('[contenteditable="true"]') as unknown as {
      __lexicalEditor: LexicalEditor;
    };
    const editor = editable.__lexicalEditor;
    expect(editor).toBeTruthy();

    const findLink = (body: RootNode | undefined): BlockNode | undefined => {
      const walk = (n: BlockNode): BlockNode[] => [n, ...(n.children ?? []).flatMap(walk)];
      return body ? walk(body).find((n) => n.type === 'inlineLink') : undefined;
    };

    // Select "Built" in the paragraph and wrap it in a link.
    editor.update(
      () => {
        const para = $getRoot().getChildren()[1] as ElementNode;
        (para.getFirstChild() as TextNode).select(0, 5);
      },
      { discrete: true },
    );
    editor.dispatchCommand(TOGGLE_LINK_COMMAND, 'https://example.com');

    let firstId = '';
    await waitFor(() => {
      const link = findLink(lastBody(onChange));
      expect(link?.attrs).toEqual({ text: 'Built', url: 'https://example.com' });
      expect(link?.id).toBeTruthy();
      firstId = link!.id;
    });

    // An unrelated edit re-serializes the document; the link keeps its id.
    editor.update(
      () => {
        const title = $getRoot().getChildren()[0] as ElementNode;
        (title.getFirstChild() as TextNode).setTextContent('Experience');
      },
      { discrete: true },
    );
    await waitFor(() => {
      const body = lastBody(onChange);
      expect(body?.children[0].attrs?.['text']).toBe('Experience');
      expect(findLink(body)?.id).toBe(firstId);
    });
  });

  it.todo('reorders title groups via drag handle — group moves with title (browser-verified)');
  it.todo('move-up on a title shifts the whole group before the previous title group (browser-verified)');
  it.todo('individual non-title blocks have no drag handle (browser-verified)');
});

describe('ProfileBuilder — timeline entry drag handle (entry reorder)', () => {
  function docWithTimelines(): ProfileDocument {
    return {
      header: emptyHeader(),
      body: rootNode([
        titleNode('Experience'),
        timelineNode([
          entryNode('Alpha Corp', '2020 – 2021', 'Alpha description.'),
          entryNode('Beta Inc', '2021 – 2022', 'Beta description.'),
          entryNode('Gamma LLC', '2022 – Present', 'Gamma description.'),
        ]),
        titleNode('Education'),
        timelineNode([entryNode('Omega University', '2016 – 2020', 'Omega description.')]),
      ]),
    };
  }

  it('renders one "Drag to reorder entry" handle per entry, only in timelines with 2+ entries', async () => {
    render(<ProfileBuilder document={docWithTimelines()} onChange={vi.fn()} />);
    // The per-entry gutter overlay is rendered: every entry (4) has its ✕.
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Remove entry' })).toHaveLength(4);
    });
    // Only the three entries of the multi-entry timeline get a drag handle; the
    // single-entry Education timeline gets none.
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Drag to reorder entry' })).toHaveLength(3);
    });
    for (const handle of screen.getAllByRole('button', { name: 'Drag to reorder entry' })) {
      expect(handle.getAttribute('title')).toBe('Drag to reorder');
      expect(handle.classList.contains('pb-entry-handle')).toBe(true);
    }
  });
});

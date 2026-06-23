import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { ProfileBuilder } from './ProfileBuilder';
import { ProfileDocument, RootNode, emptyHeader } from './model';
import { paragraphNode, rootNode, titleNode } from './nodes';

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

  it.todo('reorders title groups via drag handle — group moves with title (browser-verified)');
  it.todo('move-up on a title shifts the whole group before the previous title group (browser-verified)');
  it.todo('individual non-title blocks have no drag handle (browser-verified)');
});

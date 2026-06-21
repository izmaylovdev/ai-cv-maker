import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ProfileBuilder } from './ProfileBuilder';
import { ProfileDocument, RootNode, emptyHeader } from './model';
import { paragraphNode, rootNode, sectionNode } from './nodes';

function docWithOneSection(): ProfileDocument {
  const section = { ...sectionNode('Work Experience'), children: [paragraphNode('Built things.')] };
  return { header: emptyHeader(), body: rootNode([section]) };
}

function lastBody(onChange: ReturnType<typeof vi.fn>): RootNode | undefined {
  const call = onChange.mock.calls.at(-1);
  return call?.[0]?.body as RootNode | undefined;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ProfileBuilder — single Lexical document (US-EDIT-14)', () => {
  it('renders the fixed header letterhead inputs', () => {
    render(<ProfileBuilder document={docWithOneSection()} onChange={vi.fn()} />);
    expect(screen.getByLabelText(/full name/i)).toBeTruthy();
    expect(screen.getByLabelText(/job title/i)).toBeTruthy();
  });

  it('offers a section action and the four predefined widgets in the insert toolbar', () => {
    render(<ProfileBuilder document={docWithOneSection()} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /\+ section/i })).toBeTruthy();
    for (const name of ['Text', 'Chips', 'List', 'Timeline']) {
      expect(screen.getByRole('button', { name: new RegExp(`\\+ ${name}`, 'i') })).toBeTruthy();
    }
  });

  it('emits the full document (header + body) on edit', async () => {
    const onChange = vi.fn();
    render(<ProfileBuilder document={{ header: emptyHeader(), body: rootNode([]) }} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /\+ section/i }));
    await waitFor(() => {
      expect(lastBody(onChange)?.children?.length).toBe(1);
    });
    expect(lastBody(onChange)?.children?.[0]?.type).toBe('section');
  });

  // Robust per-widget insertion (handling Lexical's normalization of freshly
  // inserted empty chips/timeline/list widgets, plus caret-precise nesting) is
  // part of the remaining editor-UI work — see the editor follow-up.
  it.todo('inserts a chips/list/timeline widget into the current section');

  it('does not emit a no-op change when the host echoes the same body back', () => {
    const onChange = vi.fn();
    const doc = docWithOneSection();
    const { rerender } = render(<ProfileBuilder document={doc} onChange={onChange} />);
    onChange.mockClear();
    // Re-render with an equal (but re-parsed) document — must not loop.
    rerender(<ProfileBuilder document={JSON.parse(JSON.stringify(doc))} onChange={onChange} />);
    expect(onChange).not.toHaveBeenCalled();
  });
});

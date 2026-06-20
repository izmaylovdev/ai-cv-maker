import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ProfileBuilder } from './ProfileBuilder';
import {
  ProfileDocument,
  EntrySection,
  FreeFormSection,
} from './model';

function timelineDoc(): ProfileDocument {
  return {
    sections: [
      {
        id: 's1',
        template: 'timeline',
        heading: 'Work Experience',
        items: [
          {
            id: 'i1',
            title: 'Senior Engineer',
            dates: 'Jan 2022 – Present',
            description: 'Built things.',
          },
        ],
      },
    ],
  };
}

function openPalette() {
  fireEvent.click(screen.getByRole('button', { name: /add section/i }));
}

describe('Empty state (F-EDIT-8.3)', () => {
  it('shows guidance and an add-section affordance when there are no sections', () => {
    render(<ProfileBuilder document={{ sections: [] }} onChange={vi.fn()} />);
    expect(screen.getByText(/add your first section/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /add section/i })).toBeTruthy();
  });
});

describe('Template palette (F-EDIT-9.1, F-EDIT-9.3, F-EDIT-9.4, F-EDIT-9.5)', () => {
  it('lists templates with a name and description, and inserts a seeded section', () => {
    const onChange = vi.fn();
    render(<ProfileBuilder document={{ sections: [] }} onChange={onChange} />);

    openPalette();
    // Names + descriptions are visible in the palette.
    expect(screen.getByText('Timeline')).toBeTruthy();
    expect(screen.getByText(/dated entries/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /add timeline/i }));

    // A seeded timeline section is now present with one starter item.
    const last = onChange.mock.calls.at(-1)![0] as ProfileDocument;
    expect(last.sections).toHaveLength(1);
    const sec = last.sections[0] as EntrySection;
    expect(sec.template).toBe('timeline');
    expect(sec.items).toHaveLength(1);
  });
});

describe('Timeline template (F-EDIT-10.1, F-EDIT-10.2)', () => {
  it('renders Title, a free-text Dates field, and a Description for each item', () => {
    render(<ProfileBuilder document={timelineDoc()} onChange={vi.fn()} />);
    expect((screen.getByLabelText(/^title$/i) as HTMLInputElement).value).toBe('Senior Engineer');
    expect((screen.getByLabelText(/^dates$/i) as HTMLInputElement).value).toBe('Jan 2022 – Present');
    expect(screen.getByLabelText(/description/i)).toBeTruthy();
  });

  it('adds and removes items within the section', () => {
    const onChange = vi.fn();
    render(<ProfileBuilder document={timelineDoc()} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: /add item/i }));
    let doc = onChange.mock.calls.at(-1)![0] as ProfileDocument;
    expect((doc.sections[0] as EntrySection).items).toHaveLength(2);

    // Remove the first item.
    fireEvent.click(screen.getAllByRole('button', { name: /remove item/i })[0]);
    doc = onChange.mock.calls.at(-1)![0] as ProfileDocument;
    expect((doc.sections[0] as EntrySection).items).toHaveLength(1);
  });
});

describe('List template (F-EDIT-9.2, F-EDIT-9.6)', () => {
  it('offers Timeline and List in the palette', () => {
    render(<ProfileBuilder document={{ sections: [] }} onChange={vi.fn()} />);
    openPalette();
    expect(screen.getByRole('button', { name: /add timeline/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /add list/i })).toBeTruthy();
  });

  it('edits a List section like a document — Enter adds a bullet, Backspace removes it', () => {
    const onChange = vi.fn();
    const doc: ProfileDocument = {
      sections: [
        {
          id: 'l1',
          template: 'list',
          heading: 'Skills',
          items: [{ id: 'li1', text: 'TypeScript' }],
        },
      ],
    };
    render(<ProfileBuilder document={doc} onChange={onChange} />);

    expect((screen.getByLabelText(/list item/i) as HTMLInputElement).value).toBe('TypeScript');

    // Enter starts a new bullet.
    fireEvent.keyDown(screen.getByLabelText(/list item/i), { key: 'Enter' });
    let last = onChange.mock.calls.at(-1)![0] as ProfileDocument;
    expect((last.sections[0] as { items: unknown[] }).items).toHaveLength(2);

    // Backspace at the start of the new (empty) line merges it away.
    const lines = screen.getAllByLabelText(/list item/i);
    fireEvent.keyDown(lines[lines.length - 1], { key: 'Backspace' });
    last = onChange.mock.calls.at(-1)![0] as ProfileDocument;
    expect((last.sections[0] as { items: unknown[] }).items).toHaveLength(1);
  });

  it('does not render per-item buttons in a List section', () => {
    const doc: ProfileDocument = {
      sections: [
        { id: 'l1', template: 'list', heading: 'Skills', items: [{ id: 'li1', text: 'React' }] },
      ],
    };
    render(<ProfileBuilder document={doc} onChange={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /add item/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /remove item/i })).toBeNull();
  });
});

describe('General-purpose section (F-EDIT-11.1)', () => {
  it('edits the heading and free-form body', () => {
    const onChange = vi.fn();
    const doc: ProfileDocument = {
      sections: [{ id: 's1', template: 'free-form', heading: 'About', body: '' }],
    };
    render(<ProfileBuilder document={doc} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText(/section heading/i), {
      target: { value: 'Summary' },
    });
    fireEvent.change(screen.getByLabelText(/section body/i), {
      target: { value: 'Hello world' },
    });

    const last = onChange.mock.calls.at(-1)![0] as ProfileDocument;
    const sec = last.sections[0] as FreeFormSection;
    expect(sec.body).toBe('Hello world');
  });
});

describe('Reorder & remove sections (F-EDIT-12.1, F-EDIT-12.2)', () => {
  function twoSectionDoc(): ProfileDocument {
    return {
      sections: [
        { id: 'a', template: 'free-form', heading: 'First', body: 'content' },
        { id: 'b', template: 'free-form', heading: 'Second', body: '' },
      ],
    };
  }

  it('reorders sections with the arrow-button fallback', () => {
    const onChange = vi.fn();
    render(<ProfileBuilder document={twoSectionDoc()} onChange={onChange} />);

    fireEvent.click(screen.getAllByRole('button', { name: /move section down/i })[0]);
    const doc = onChange.mock.calls.at(-1)![0] as ProfileDocument;
    expect(doc.sections.map((s) => s.id)).toEqual(['b', 'a']);
  });

  it('requires confirmation before removing a non-empty section', () => {
    const onChange = vi.fn();
    render(<ProfileBuilder document={twoSectionDoc()} onChange={onChange} />);

    const first = screen.getByDisplayValue('First').closest('[data-section]') as HTMLElement;
    fireEvent.click(within(first).getByRole('button', { name: /remove section/i }));

    // Non-empty: not removed yet — a confirm affordance appears instead.
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(within(first).getByRole('button', { name: /confirm remove/i }));

    const doc = onChange.mock.calls.at(-1)![0] as ProfileDocument;
    expect(doc.sections.map((s) => s.id)).toEqual(['b']);
  });

  it('removes an empty section without confirmation', () => {
    const onChange = vi.fn();
    render(<ProfileBuilder document={twoSectionDoc()} onChange={onChange} />);

    const second = screen.getByDisplayValue('Second').closest('[data-section]') as HTMLElement;
    fireEvent.click(within(second).getByRole('button', { name: /remove section/i }));

    const doc = onChange.mock.calls.at(-1)![0] as ProfileDocument;
    expect(doc.sections.map((s) => s.id)).toEqual(['a']);
  });
});

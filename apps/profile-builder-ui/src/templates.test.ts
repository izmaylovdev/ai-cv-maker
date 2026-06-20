import { describe, it, expect } from 'vitest';
import { DEFAULT_SECTION_TEMPLATES } from './templates';
import { EntrySection } from './model';

describe('DEFAULT_SECTION_TEMPLATES (F-EDIT-9.2, F-EDIT-9.6)', () => {
  it('ships general-purpose, timeline, and list templates', () => {
    const ids = DEFAULT_SECTION_TEMPLATES.map((t) => t.id);
    expect(ids).toContain('free-form');
    expect(ids).toContain('timeline');
    expect(ids).toContain('list');
  });

  it('every template exposes a name and a one-line description (F-EDIT-9.3)', () => {
    for (const t of DEFAULT_SECTION_TEMPLATES) {
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(0);
    }
  });
});

describe('template.create() seeds a section (F-EDIT-9.5)', () => {
  it('creates sections with fresh, unique ids', () => {
    const tl = DEFAULT_SECTION_TEMPLATES.find((t) => t.id === 'timeline')!;
    const a = tl.create();
    const b = tl.create();
    expect(a.id).toBeTruthy();
    expect(a.id).not.toEqual(b.id);
  });

  it('timeline seeds one empty entry item', () => {
    const tl = DEFAULT_SECTION_TEMPLATES.find((t) => t.id === 'timeline')!;
    const section = tl.create() as EntrySection;
    expect(section.template).toBe('timeline');
    expect(section.items).toHaveLength(1);
    expect(section.items[0].title).toBe('');
  });

  it('free-form seeds a heading and an empty body', () => {
    const ff = DEFAULT_SECTION_TEMPLATES.find((t) => t.id === 'free-form')!;
    const section = ff.create();
    expect(section.template).toBe('free-form');
    expect(section.heading.length).toBeGreaterThan(0);
  });

  it('list seeds one empty list item', () => {
    const list = DEFAULT_SECTION_TEMPLATES.find((t) => t.id === 'list')!;
    const section = list.create();
    expect(section.template).toBe('list');
    if (section.template !== 'list') throw new Error('unreachable');
    expect(section.items).toHaveLength(1);
    expect(section.items[0].text).toBe('');
  });
});

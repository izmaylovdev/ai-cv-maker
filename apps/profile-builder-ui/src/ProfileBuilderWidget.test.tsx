// Integration tests for the ProfileBuilderWidget custom element (<applysy-profile-builder>).
// These exercise the web component boundary — the layer that ProfileBuilder.test.tsx
// does NOT cover — specifically the timing scenario that caused the body-not-rendering
// regression: a host (e.g. Angular) pushing a document synchronously inside the same
// microtask as connectedCallback, before React's first commit.

import { describe, it, expect, afterEach } from 'vitest';
import { waitFor } from '@testing-library/dom';
import './main';  // registers <applysy-profile-builder>
import { ProfileDocument, emptyHeader } from './model';
import { paragraphNode, rootNode, titleNode, timelineNode, entryNode, chipsNode } from './nodes';

function makeDoc(overrides?: Partial<ProfileDocument['body']['children']>): ProfileDocument {
  return {
    header: { ...emptyHeader(), fullName: 'Jane Doe', title: 'Staff Engineer' },
    body: rootNode(
      overrides ?? [
        titleNode('Summary'),
        paragraphNode('Builds things that scale.'),
        titleNode('Skills'),
        chipsNode([{ id: 'c1', text: 'TypeScript' }, { id: 'c2', text: 'Go' }]),
      ],
    ),
  };
}

function mount(): HTMLElement & { document: ProfileDocument } {
  const el = document.createElement('applysy-profile-builder') as HTMLElement & {
    document: ProfileDocument;
  };
  document.body.appendChild(el);   // connectedCallback fires synchronously here
  return el;
}

afterEach(() => {
  // Clean up any mounted widgets.
  document.body.querySelectorAll('applysy-profile-builder').forEach((el) => el.remove());
});

describe('ProfileBuilderWidget — web component seeding (regression: body-not-rendering)', () => {
  it('renders body content when document is set synchronously after connectedCallback', async () => {
    // Reproduces the Angular effect() timing: the property setter fires in the
    // same synchronous call stack as appendChild, before React's first paint.
    // With the old bodyJsonRef = useRef(JSON.stringify(document.body)) this test
    // failed because LoadBodyPlugin's guard saw json === bodyJsonRef.current and
    // skipped loadDocument entirely.
    const el = mount();
    el.document = makeDoc();   // synchronous — same tick as connectedCallback

    await waitFor(() => {
      expect(el.textContent).toContain('Summary');
      expect(el.textContent).toContain('Builds things that scale.');
      expect(el.textContent).toContain('Skills');
    });
  });

  it('renders body content when document is set after a microtask delay', async () => {
    // Covers the alternative timing: host pushes document after awaiting the
    // custom-element definition (e.g. customElements.whenDefined().then(...)).
    const el = mount();
    await Promise.resolve();   // one microtask — React may have started its first render
    el.document = makeDoc();

    await waitFor(() => {
      expect(el.textContent).toContain('Builds things that scale.');
    });
  });

  it('re-seeds the editor when document is replaced (optimize / extract flows)', async () => {
    const el = mount();
    const first = makeDoc();
    el.document = first;
    await waitFor(() => expect(el.textContent).toContain('Builds things that scale.'));

    const second: ProfileDocument = {
      header: { ...emptyHeader(), fullName: 'Jane Doe', title: 'Staff Engineer' },
      body: rootNode([
        titleNode('Experience'),
        paragraphNode('Joined the platform team.'),
      ]),
    };
    el.document = second;

    await waitFor(() => {
      expect(el.textContent).toContain('Experience');
      expect(el.textContent).toContain('Joined the platform team.');
      expect(el.textContent).not.toContain('Builds things that scale.');
    });
  });

  it('emits documentchange events reflecting edits from inside the editor', async () => {
    // Smoke-test the output boundary: the widget must fire CustomEvents that
    // carry the current ProfileDocument as `detail`.
    const el = mount();
    el.document = makeDoc();

    const events: ProfileDocument[] = [];
    el.addEventListener('documentchange', (e) => {
      events.push((e as CustomEvent<ProfileDocument>).detail);
    });

    await waitFor(() => {
      // At least one change emitted once the trailing-paragraph plugin settles.
      expect(events.length).toBeGreaterThan(0);
      expect(events[0]).toHaveProperty('header');
      expect(events[0]).toHaveProperty('body');
    });
  });

  it('renders a timeline section with multiple entries', async () => {
    const el = mount();
    el.document = {
      header: emptyHeader(),
      body: rootNode([
        titleNode('Work Experience'),
        timelineNode([
          entryNode('Senior Eng · Acme', '2022 – Present', 'Led platform.'),
          entryNode('Eng · Beta Corp', '2019 – 2022', 'Built APIs.'),
        ]),
      ]),
    };

    await waitFor(() => {
      expect(el.textContent).toContain('Work Experience');
      expect(el.textContent).toContain('Senior Eng · Acme');
      expect(el.textContent).toContain('2022 – Present');
      expect(el.textContent).toContain('Eng · Beta Corp');
    });
  });

  it('migrates a legacy section document pushed synchronously on mount', async () => {
    // Combines the timing regression with the section-migration path:
    // a stored profile with old `section` nodes pushed before React's first paint.
    const el = mount();
    const legacyDoc: ProfileDocument = {
      header: emptyHeader(),
      body: {
        type: 'root',
        id: 'r1',
        children: [
          {
            type: 'section',
            id: 's1',
            attrs: { heading: 'Summary' },
            children: [paragraphNode('Pioneered computing.')],
          } as never,
        ],
      },
    };
    el.document = legacyDoc;

    await waitFor(() => {
      expect(el.textContent).toContain('Summary');
      expect(el.textContent).toContain('Pioneered computing.');
    });
  });
});

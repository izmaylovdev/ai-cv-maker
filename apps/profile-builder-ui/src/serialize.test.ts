import { describe, it, expect } from 'vitest';
import { $getRoot, createEditor } from 'lexical';
import { WIDGET_NODES, $isTitleNode } from './lexical/widget-nodes';
import { loadDocument, readDocument } from './serialize';
import {
  chipsNode,
  entryNode,
  linkNode,
  listItemNode,
  listNode,
  paragraphNode,
  rootNode,
  timelineNode,
  titleNode,
} from './nodes';
import { BlockNode, ProfileDocument, RootNode, emptyHeader, validateDocument } from './model';

/** Headless editor configured with our widget node allow-list. */
function makeEditor() {
  return createEditor({
    namespace: 'pb-test',
    nodes: WIDGET_NODES,
    onError: (e) => {
      throw e;
    },
  });
}

/** Round-trip a body tree through Lexical and back, preserving the root id. */
function roundTrip(body: RootNode): RootNode {
  const editor = makeEditor();
  loadDocument(editor, body);
  return readDocument(editor, body.id);
}

/** A deeply-mixed valid body tree using the new flat (title-anchored) model. */
function richBody(): RootNode {
  const entry = entryNode('Senior Engineer', 'Jan 2022 – Present', 'Led the team.');
  entry.children = [
    paragraphNode('Led the team.'),
    listNode(['Shipped editor', 'Mentored']),
    linkNode('Case study', 'https://example.com/case'),
  ];

  const item = listItemNode('Top');
  item.children = [paragraphNode('Top'), listNode(['Sub a', 'Sub b']), chipsNode(['tag'])];
  const outerList = listNode();
  outerList.children = [item];

  return rootNode([
    titleNode('Summary'),
    paragraphNode('Product-minded engineer.'),
    linkNode('Portfolio', 'https://example.com'),
    titleNode('Work Experience'),
    timelineNode([entry]),
    titleNode('Skills'),
    chipsNode(['TypeScript', 'React', 'Node.js']),
    titleNode('Nested'),
    outerList,
  ]);
}

describe('serialize round-trip (ADR-0014 §9.4 / US-EDIT-19 §13)', () => {
  it('is identity for an empty document', () => {
    const body = rootNode([]);
    expect(roundTrip(body)).toEqual(body);
  });

  it('is identity for a single title node', () => {
    const body = rootNode([titleNode('About')]);
    expect(roundTrip(body)).toEqual(body);
  });

  it('is identity for a title followed by flow content', () => {
    const body = rootNode([titleNode('Summary'), paragraphNode('Hello world')]);
    expect(roundTrip(body)).toEqual(body);
  });

  it('preserves all node types, ids, attrs, and order', () => {
    const body = richBody();
    expect(roundTrip(body)).toEqual(body);
  });

  it('preserves stable ids across the round trip', () => {
    const body = richBody();
    const out = roundTrip(body);
    type Tree = { id: string; children?: Tree[] };
    const ids = (n: Tree): string[] => [n.id, ...(n.children ?? []).flatMap(ids)];
    expect(ids(out as unknown as Tree)).toEqual(ids(body as unknown as Tree));
  });

  it('produces a tree that passes schema validation', () => {
    const doc: ProfileDocument = { header: emptyHeader(), body: roundTrip(richBody()) };
    expect(validateDocument(doc).valid).toBe(true);
  });

  it('round-trips a link node, preserving text + url attrs and id (US-EDIT-15)', () => {
    const link = linkNode('Portfolio', 'https://example.com');
    const body = rootNode([titleNode('Links'), link]);
    const out = roundTrip(body);
    expect(out).toEqual(body);
    const outLink = out.children[1];
    expect(outLink.type).toBe('link');
    expect(outLink.attrs).toEqual({ text: 'Portfolio', url: 'https://example.com' });
    expect(outLink.id).toBe(link.id);
  });

  it('round-trips orphan flow nodes (no title before them)', () => {
    const body = rootNode([paragraphNode('Intro'), listNode(['a', 'b'])]);
    expect(roundTrip(body)).toEqual(body);
  });

  it('does not produce section nodes in the output (section is retired)', () => {
    const body = richBody();
    const out = roundTrip(body);
    const allTypes = (n: BlockNode): string[] => [
      n.type,
      ...(n.children ?? []).flatMap(allTypes),
    ];
    expect(allTypes(out)).not.toContain('section');
  });
});

describe('legacy section migration (F-EDIT-19.8)', () => {
  it('converts a section to a title + flat children when loading', () => {
    // Simulate a legacy document with a section node (bypass TypeScript).
    const legacyBody = {
      type: 'root',
      id: 'r1',
      children: [
        {
          type: 'section',
          id: 's1',
          attrs: { heading: 'Work Experience' },
          children: [paragraphNode('Worked hard.')],
        },
      ],
    } as unknown as RootNode;

    const out = roundTrip(legacyBody);

    // The section is gone; a title node with the heading text appears instead.
    expect(out.children[0].type).toBe('title');
    expect(out.children[0].attrs?.['text']).toBe('Work Experience');
    // The section's former child is now a sibling at root level.
    expect(out.children[1].type).toBe('paragraph');
  });

  it('flattens multiple sections into a flat title + content sequence', () => {
    const legacyBody = {
      type: 'root',
      id: 'r1',
      children: [
        {
          type: 'section',
          id: 's1',
          attrs: { heading: 'Summary' },
          children: [paragraphNode('Bio.')],
        },
        {
          type: 'section',
          id: 's2',
          attrs: { heading: 'Skills' },
          children: [chipsNode(['TS', 'React'])],
        },
      ],
    } as unknown as RootNode;

    const out = roundTrip(legacyBody);

    expect(out.children.map((c) => c.type)).toEqual([
      'title', 'paragraph', 'title', 'chips',
    ]);
    expect(out.children[0].attrs?.['text']).toBe('Summary');
    expect(out.children[2].attrs?.['text']).toBe('Skills');
  });

  it('migrated tree passes schema validation', () => {
    const legacyBody = {
      type: 'root',
      id: 'r1',
      children: [
        {
          type: 'section',
          id: 's1',
          attrs: { heading: 'Experience' },
          children: [timelineNode([entryNode('Dev', '2020', 'Built things.')])],
        },
      ],
    } as unknown as RootNode;

    const out = roundTrip(legacyBody);
    const doc: ProfileDocument = { header: emptyHeader(), body: out };
    expect(validateDocument(doc).valid).toBe(true);
  });
});

describe('title group reorder primitive (F-EDIT-19.4 / F-EDIT-19.5)', () => {
  it('moving a title up moves the title and all its group content before the previous title group', () => {
    const editor = makeEditor();
    const body = rootNode([
      titleNode('A'),
      paragraphNode('a-body'),
      titleNode('B'),
      paragraphNode('b-body'),
      titleNode('C'),
    ]);
    loadDocument(editor, body);

    // Move the "B" title group (title + paragraph) before "A" group.
    editor.update(
      () => {
        const root = $getRoot();
        const children = root.getChildren();
        // children: [title-A, para-a, title-B, para-b, title-C]
        // Move title-B and para-b before title-A.
        const titleB = children[2];
        const paraB = children[3];
        const titleA = children[0];
        titleA.insertBefore(titleB);
        titleB.insertAfter(paraB);
      },
      { discrete: true },
    );

    const out = readDocument(editor, body.id);
    // After move: title-B, para-b, title-A, para-a, title-C
    expect(out.children[0].type).toBe('title');
    expect(out.children[0].attrs?.['text']).toBe('B');
    expect(out.children[1].type).toBe('paragraph');
    expect(out.children[2].attrs?.['text']).toBe('A');
  });

  it('preserves group content (paragraphs, widgets) after reorder', () => {
    const editor = makeEditor();
    const body = rootNode([
      titleNode('A'),
      paragraphNode('a-body'),
      titleNode('B'),
    ]);
    loadDocument(editor, body);

    // Move group A (title-A + para-a) after title-B by appending both to end.
    editor.update(
      () => {
        const root = $getRoot();
        const [titleA, paraA] = root.getChildren();
        root.append(titleA);
        root.append(paraA);
      },
      { discrete: true },
    );

    const out = readDocument(editor, body.id);
    // Order should now be: title-B, title-A, para-a
    expect(out.children[0].type).toBe('title');
    expect(out.children[0].attrs?.['text']).toBe('B');
    expect(out.children[1].attrs?.['text']).toBe('A');
    expect(out.children[2].type).toBe('paragraph');
  });

  it('identifies title nodes at root level by type', () => {
    const editor = makeEditor();
    loadDocument(editor, richBody());
    const titleCount = editor.getEditorState().read(() =>
      $getRoot().getChildren().filter($isTitleNode).length,
    );
    expect(titleCount).toBe(4); // richBody has 4 titleNode calls
  });
});

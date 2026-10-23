import { describe, it, expect } from 'vitest';
import { $createTextNode, $getRoot, ElementNode, createEditor } from 'lexical';
import { $createAutoLinkNode, $isLinkNode } from '@lexical/link';
import { WIDGET_NODES, $isTitleNode } from './lexical/widget-nodes';
import { loadDocument, readDocument } from './serialize';
import {
  chipsNode,
  entryNode,
  inlineLinkNode,
  listItemNode,
  listNode,
  paragraphNode,
  textNode,
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

/** A paragraph holding a single inline link run (the only kind of link, spec: stock LinkNode). */
function linkParagraph(text: string, url: string) {
  return { ...paragraphNode(''), children: [inlineLinkNode(text, url)] };
}

/** A legacy standalone `link` block, as stored before the block was retired. */
function legacyLink(id: string, text: string, url: string): BlockNode {
  return { type: 'link', id, attrs: { text, url } } as unknown as BlockNode;
}

/** Every node in a tree, depth-first. */
function allNodes(n: BlockNode): BlockNode[] {
  return [n, ...(n.children ?? []).flatMap(allNodes)];
}

/** A deeply-mixed valid body tree using the new flat (title-anchored) model. */
function richBody(): RootNode {
  const entry = entryNode('Senior Engineer', 'Jan 2022 – Present', 'Led the team.');
  entry.children = [
    paragraphNode('Led the team.'),
    listNode(['Shipped editor', 'Mentored']),
    linkParagraph('Case study', 'https://example.com/case'),
  ];

  const item = listItemNode('Top');
  item.children = [paragraphNode('Top'), listNode(['Sub a', 'Sub b']), chipsNode(['tag'])];
  const outerList = listNode();
  outerList.children = [item];

  return rootNode([
    titleNode('Summary'),
    paragraphNode('Product-minded engineer.'),
    linkParagraph('Portfolio', 'https://example.com'),
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

  it('round-trips an inline link inside a paragraph, preserving runs + ids (US-EDIT-21)', () => {
    const para = paragraphNode('');
    para.children = [
      textNode('See my '),
      inlineLinkNode('portfolio', 'https://me.dev'),
      textNode(' here.'),
    ];
    const body = rootNode([titleNode('Summary'), para]);
    const out = roundTrip(body);
    expect(out).toEqual(body);
    const outPara = out.children[1];
    expect(outPara.children?.map((c) => c.type)).toEqual(['text', 'inlineLink', 'text']);
    const link = outPara.children?.[1];
    expect(link?.attrs).toEqual({ text: 'portfolio', url: 'https://me.dev' });
  });

  it('round-trips an inline link inside a list item (US-EDIT-21)', () => {
    const item = listItemNode('');
    item.children = [
      { ...paragraphNode(''), children: [textNode('Built '), inlineLinkNode('the API', 'https://api.dev')] },
    ];
    const list = listNode();
    list.children = [item];
    const body = rootNode([list]);
    const out = roundTrip(body);
    expect(out).toEqual(body);
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

describe('inline links are stock Lexical LinkNodes', () => {
  it('loads an inlineLink as the stock @lexical/link LinkNode (type "link"), not a subclass', () => {
    const editor = makeEditor();
    const para = paragraphNode('');
    para.children = [textNode('See '), inlineLinkNode('site', 'https://me.dev')];
    loadDocument(editor, rootNode([para]));
    const linkTypes = editor.getEditorState().read(() => {
      const p = $getRoot().getFirstChild() as ElementNode;
      return p.getChildren().filter($isLinkNode).map((n) => n.getType());
    });
    expect(linkTypes).toEqual(['link']);
  });

  it('serializes an AutoLinkNode (typed/pasted URL) as an ordinary inlineLink run', () => {
    const editor = makeEditor();
    loadDocument(editor, rootNode([paragraphNode('Visit ')]));
    editor.update(
      () => {
        const p = $getRoot().getFirstChild() as ElementNode;
        const auto = $createAutoLinkNode('https://example.com');
        auto.append($createTextNode('https://example.com'));
        p.append(auto);
      },
      { discrete: true },
    );
    const out = readDocument(editor, 'r');
    const runs = out.children[0].children ?? [];
    expect(runs.map((r) => r.type)).toEqual(['text', 'inlineLink']);
    expect(runs[1].attrs).toEqual({ text: 'https://example.com', url: 'https://example.com' });
    expect(allNodes(out).map((n) => n.type)).not.toContain('autolink');
  });

  it('keeps an inlineLink id stable across two serializations, including after its url changes', () => {
    const editor = makeEditor();
    const link = inlineLinkNode('portfolio', 'https://me.dev');
    const para = paragraphNode('');
    para.children = [textNode('See my '), link];
    loadDocument(editor, rootNode([para]));

    const first = readDocument(editor, 'r');
    editor.update(
      () => {
        const p = $getRoot().getFirstChild() as ElementNode;
        const l = p.getChildren().find($isLinkNode);
        l?.setURL('https://other.dev');
      },
      { discrete: true },
    );
    const second = readDocument(editor, 'r');

    const idOf = (b: RootNode) => allNodes(b).find((n) => n.type === 'inlineLink')?.id;
    expect(idOf(first)).toBe(link.id);
    expect(idOf(second)).toBe(link.id);
    expect(allNodes(second).find((n) => n.type === 'inlineLink')?.attrs?.['url']).toBe('https://other.dev');
  });
});

describe('legacy link block migration (link → paragraph > inlineLink)', () => {
  it('migrates a root-level link to a paragraph that keeps the link id and holds an inlineLink', () => {
    const body = rootNode([titleNode('Links'), legacyLink('L1', 'Portfolio', 'https://example.com') as never]);
    const out = roundTrip(body);

    expect(out.children.map((c) => c.type)).toEqual(['title', 'paragraph']);
    const para = out.children[1];
    expect(para.id).toBe('L1');
    expect(para.children?.map((c) => c.type)).toEqual(['inlineLink']);
    expect(para.children?.[0].attrs).toEqual({ text: 'Portfolio', url: 'https://example.com' });
    expect(para.children?.[0].id).toBeTruthy();
    expect(para.children?.[0].id).not.toBe('L1');
  });

  it('migrates a link inside a list item', () => {
    const item = listItemNode('Top');
    item.children = [paragraphNode('Top'), legacyLink('L2', 'Ref', 'https://example.com/ref') as never];
    const list = listNode();
    list.children = [item];
    const out = roundTrip(rootNode([list]));

    expect(allNodes(out).map((n) => n.type)).not.toContain('link');
    const para = allNodes(out).find((n) => n.id === 'L2');
    expect(para?.type).toBe('paragraph');
    expect(para?.children?.[0]).toMatchObject({ type: 'inlineLink', attrs: { text: 'Ref', url: 'https://example.com/ref' } });
  });

  it('migrates a link inside a timeline entry', () => {
    const entry = entryNode('Engineer', '2022', 'Led.');
    entry.children = [paragraphNode('Led.'), legacyLink('L3', 'Case study', 'https://example.com/case') as never];
    const out = roundTrip(rootNode([timelineNode([entry])]));

    expect(allNodes(out).map((n) => n.type)).not.toContain('link');
    const outEntry = allNodes(out).find((n) => n.type === 'entry');
    const para = outEntry?.children?.find((n) => n.id === 'L3');
    expect(para?.type).toBe('paragraph');
    expect(para?.children?.[0]).toMatchObject({
      type: 'inlineLink',
      attrs: { text: 'Case study', url: 'https://example.com/case' },
    });
  });

  it('uses the url as the label when the legacy link has empty text', () => {
    const out = roundTrip(rootNode([legacyLink('L4', '', 'https://me.dev') as never]));
    expect(out.children[0].children?.[0]).toMatchObject({
      type: 'inlineLink',
      attrs: { text: 'https://me.dev', url: 'https://me.dev' },
    });
  });

  it('migrates a legacy link with an empty url to a paragraph of plain text', () => {
    const out = roundTrip(rootNode([legacyLink('L5', 'Just text', '') as never]));
    expect(out.children).toHaveLength(1);
    expect(out.children[0].type).toBe('paragraph');
    expect(out.children[0].id).toBe('L5');
    expect(out.children[0].children?.map((c) => c.type)).toEqual(['text']);
    expect(out.children[0].children?.[0].attrs).toEqual({ text: 'Just text' });
  });

  it('drops a legacy link whose text and url are both empty', () => {
    const out = roundTrip(rootNode([titleNode('Links'), legacyLink('L6', '', '') as never]));
    expect(out.children.map((c) => c.type)).toEqual(['title']);
  });

  it('produces a migrated tree that passes schema validation', () => {
    const entry = entryNode('Engineer', '2022', '');
    entry.children = [legacyLink('L7', 'Case', 'https://c.dev') as never];
    const body = rootNode([legacyLink('L8', 'Site', 'https://s.dev') as never, timelineNode([entry])]);
    const out = roundTrip(body);
    expect(allNodes(out).map((n) => n.type)).not.toContain('link');
    const doc: ProfileDocument = { header: emptyHeader(), body: out };
    expect(validateDocument(doc)).toEqual({ valid: true, errors: [] });
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

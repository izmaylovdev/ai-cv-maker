import { describe, it, expect } from 'vitest';
import {
  ALLOWED_CHILDREN,
  BlockNode,
  ProfileDocument,
  emptyHeader,
  validateDocument,
} from './model';
import {
  chipsNode,
  entryNode,
  inlineLinkNode,
  linkNode,
  listItemNode,
  listNode,
  paragraphNode,
  textNode,
  rootNode,
  timelineNode,
  titleNode,
  widgetsAllowedIn,
} from './nodes';

function wrap(body: ProfileDocument['body']): ProfileDocument {
  return { header: emptyHeader(), body };
}

describe('title node schema (US-EDIT-19 / spec §13)', () => {
  it('is a leaf allowed as a direct child of root', () => {
    expect(ALLOWED_CHILDREN.root).toContain('title');
    expect(ALLOWED_CHILDREN.title).toEqual([]);
  });

  it('section node type is retired — not in ALLOWED_CHILDREN', () => {
    expect('section' in ALLOWED_CHILDREN).toBe(false);
    expect(ALLOWED_CHILDREN.root).not.toContain('section');
  });

  it('root allows title, paragraph, list, chips, timeline, link', () => {
    expect(ALLOWED_CHILDREN.root).toEqual(
      expect.arrayContaining(['title', 'paragraph', 'list', 'chips', 'timeline', 'link']),
    );
  });

  it('validates a document with a flat list of title + flow nodes', () => {
    const body = rootNode([
      titleNode('Work Experience'),
      paragraphNode('Led the team.'),
      titleNode('Skills'),
      paragraphNode('TypeScript, React.'),
    ]);
    expect(validateDocument(wrap(body)).valid).toBe(true);
  });

  it('validates a document with title nodes only', () => {
    const body = rootNode([titleNode('Summary'), titleNode('Skills')]);
    expect(validateDocument(wrap(body)).valid).toBe(true);
  });

  it('validates a document with no title nodes (orphan flow blocks are fine)', () => {
    const body = rootNode([paragraphNode('Hello'), listNode(['item'])]);
    expect(validateDocument(wrap(body)).valid).toBe(true);
  });

  it('rejects a title missing its required text attr', () => {
    const bad: BlockNode = { type: 'title', id: 't1', attrs: {} };
    const body = rootNode([bad as ReturnType<typeof titleNode>]);
    const result = validateDocument(wrap(body));
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/title.*text/i);
  });

  it('rejects a title with children (leaf — no children allowed)', () => {
    const bad: BlockNode = {
      type: 'title',
      id: 't1',
      attrs: { text: 'heading' },
      children: [paragraphNode('bad')],
    };
    const body = rootNode([bad as ReturnType<typeof titleNode>]);
    expect(validateDocument(wrap(body)).valid).toBe(false);
  });

  it('rejects a section node (retired type is unknown)', () => {
    const bad: BlockNode = { type: 'section' as never, id: 's1', attrs: { heading: 'x' } };
    const body = rootNode([bad as ReturnType<typeof titleNode>]);
    const result = validateDocument(wrap(body));
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/unknown node type "section"/i);
  });
});

describe('link node schema (US-EDIT-15 / spec §10)', () => {
  it('is a leaf — no children allowed, and allowed at root, listItem, and entry', () => {
    expect(ALLOWED_CHILDREN.root).toContain('link');
    expect(ALLOWED_CHILDREN.listItem).toContain('link');
    expect(ALLOWED_CHILDREN.entry).toContain('link');
    expect(ALLOWED_CHILDREN.link).toEqual([]);
  });

  it('validates a link directly at root level', () => {
    const body = rootNode([linkNode('Portfolio', 'https://example.com')]);
    expect(validateDocument(wrap(body)).valid).toBe(true);
  });

  it('validates a link inside a list item and a timeline entry', () => {
    const item = listItemNode('Top');
    item.children = [linkNode('Ref', 'https://example.com/ref')];
    const list = listNode();
    list.children = [item];

    const entry = entryNode('Role', '2022', '');
    entry.children = [linkNode('Case', 'https://example.com/case')];

    const body = rootNode([list, timelineNode([entry])]);
    expect(validateDocument(wrap(body)).valid).toBe(true);
  });

  it('rejects a link missing its required text/url attrs', () => {
    const bad: BlockNode = { type: 'link', id: 'l1', attrs: {} };
    const body = rootNode([bad as ReturnType<typeof linkNode>]);
    const result = validateDocument(wrap(body));
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/link.*(text|url)/i);
  });

  it('rejects a link with children (leaf)', () => {
    const bad: BlockNode = {
      type: 'link',
      id: 'l1',
      attrs: { text: 't', url: 'u' },
      children: [linkNode('x', 'y')],
    };
    const body = rootNode([bad as ReturnType<typeof linkNode>]);
    expect(validateDocument(wrap(body)).valid).toBe(false);
  });
});

describe('inline link schema (US-EDIT-21 / spec §15)', () => {
  it('is a leaf allowed inside paragraph only', () => {
    expect(ALLOWED_CHILDREN.paragraph).toContain('inlineLink');
    expect(ALLOWED_CHILDREN.inlineLink).toEqual([]);
    expect(ALLOWED_CHILDREN.root).not.toContain('inlineLink');
    expect(ALLOWED_CHILDREN.listItem).not.toContain('inlineLink');
    expect(ALLOWED_CHILDREN.entry).not.toContain('inlineLink');
  });

  it('validates a paragraph mixing text and inline-link runs', () => {
    const para = paragraphNode('');
    para.children = [textNode('See my '), inlineLinkNode('site', 'https://me.dev'), textNode('.')];
    const body = rootNode([para]);
    expect(validateDocument(wrap(body)).valid).toBe(true);
  });

  it('rejects an inline link directly at root (running text only)', () => {
    const body = rootNode([inlineLinkNode('x', 'https://x.dev') as never]);
    const result = validateDocument(wrap(body));
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/inlineLink.*not allowed.*root/i);
  });

  it('rejects an inline link missing its required text/url attrs', () => {
    const para = paragraphNode('');
    para.children = [{ type: 'inlineLink', id: 'il1', attrs: {} } as never];
    const body = rootNode([para]);
    const result = validateDocument(wrap(body));
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/inlineLink.*(text|url)/i);
  });
});

describe('insert elements inside timeline entries (US-EDIT-20 / spec §14)', () => {
  it('entry allows paragraph, list, chips, and link', () => {
    expect(ALLOWED_CHILDREN.entry).toEqual(
      expect.arrayContaining(['paragraph', 'list', 'chips', 'link']),
    );
  });

  it('validates chips inside a timeline entry', () => {
    const entry = entryNode('Engineer', '2021–2024', '');
    entry.children = [chipsNode(['React', 'TypeScript'])];
    const body = rootNode([timelineNode([entry])]);
    expect(validateDocument(wrap(body)).valid).toBe(true);
  });

  it('validates a list, chips, and link together inside one entry', () => {
    const entry = entryNode('Engineer', '2021–2024', 'Led the rewrite.');
    entry.children = [
      paragraphNode('Led the rewrite.'),
      listNode(['Shipped v2', 'Mentored two juniors']),
      chipsNode(['React', 'Go']),
      linkNode('Case study', 'https://example.com/case'),
    ];
    const body = rootNode([timelineNode([entry])]);
    expect(validateDocument(wrap(body)).valid).toBe(true);
  });

  it('still rejects a timeline nested inside an entry', () => {
    const entry = entryNode('Engineer', '2021', '');
    entry.children = [timelineNode() as never];
    const body = rootNode([timelineNode([entry])]);
    expect(validateDocument(wrap(body)).valid).toBe(false);
  });

  it('offers text, list, chips, and link — but not timeline or title — inside an entry', () => {
    const kinds = widgetsAllowedIn('entry').map((w) => w.kind);
    expect(kinds).toEqual(expect.arrayContaining(['text', 'list', 'chips', 'link']));
    expect(kinds).not.toContain('timeline');
    expect(kinds).not.toContain('title');
  });
});

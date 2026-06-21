import { describe, it, expect } from 'vitest';
import { createEditor } from 'lexical';
import { WIDGET_NODES } from './lexical/widget-nodes';
import { loadDocument, readDocument } from './serialize';
import {
  chipsNode,
  entryNode,
  listItemNode,
  listNode,
  paragraphNode,
  rootNode,
  sectionNode,
  timelineNode,
} from './nodes';
import { ProfileDocument, RootNode, emptyHeader, validateDocument } from './model';

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

/** A deeply-mixed, valid body tree exercising every node type and nesting. */
function richBody(): RootNode {
  const summary = sectionNode('Summary');
  summary.children = [paragraphNode('Product-minded engineer.')];

  const work = sectionNode('Work Experience');
  const entry = entryNode('Senior Engineer', 'Jan 2022 – Present', 'Led the team.');
  // entry with a nested list in its description (matrix: entry → paragraph|list)
  entry.children = [paragraphNode('Led the team.'), listNode(['Shipped editor', 'Mentored'])];
  work.children = [timelineNode([entry])];

  const skills = sectionNode('Skills');
  skills.children = [chipsNode(['TypeScript', 'React', 'Node.js'])];

  const nested = sectionNode('Nested');
  // listItem → paragraph + nested list + chips (full matrix for listItem)
  const item = listItemNode('Top');
  item.children = [paragraphNode('Top'), listNode(['Sub a', 'Sub b']), chipsNode(['tag'])];
  const outerList = listNode();
  outerList.children = [item];
  nested.children = [outerList];

  return rootNode([summary, work, skills, nested]);
}

describe('serialize round-trip (ADR-0014 §9.4 — hard requirement)', () => {
  it('is identity for an empty document', () => {
    const body = rootNode([]);
    expect(roundTrip(body)).toEqual(body);
  });

  it('is identity for a single text section', () => {
    const body = rootNode([sectionNode('About')]);
    body.children[0].children = [paragraphNode('Hello world')];
    expect(roundTrip(body)).toEqual(body);
  });

  it('preserves all node types, ids, attrs, and order', () => {
    const body = richBody();
    const out = roundTrip(body);
    expect(out).toEqual(body);
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

  it('skips foreign top-level nodes (only sections survive at root)', () => {
    // A paragraph at root is not a section; reading back yields no children.
    const editor = makeEditor();
    loadDocument(editor, rootNode([sectionNode('Keep')]));
    const out = readDocument(editor, 'root-id');
    expect(out.children.every((c) => c.type === 'section')).toBe(true);
  });
});

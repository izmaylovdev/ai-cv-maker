// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { ProfileDocument, applyPatch, emptyHeader } from './model';
import { chipsNode, listNode, paragraphNode, rootNode, titleNode } from './nodes';

// US-AI-9 / spec §6.4 — applyPatch: apply an ordered op list to a clone of the
// document, then validate. The whole patch is atomic: an op set that yields an
// invalid (ADR-0014 schema-violating) document is rejected and the ORIGINAL
// document is returned unchanged.

function doc(body: ProfileDocument['body']): ProfileDocument {
  return { header: emptyHeader(), body };
}

describe('applyPatch — convertNode (list ⇄ chips)', () => {
  it('converts a list to chips in place, mapping each item to a chip', () => {
    const list = listNode(['TypeScript', 'Go']);
    const before = doc(rootNode([titleNode('Skills'), list]));

    const { document, result } = applyPatch(before, {
      ops: [{ op: 'convertNode', id: list.id, to: 'chips' }],
    });

    expect(result.valid).toBe(true);
    const converted = document.body.children![1];
    expect(converted.type).toBe('chips');
    expect(converted.children!.map((c) => c.type)).toEqual(['chip', 'chip']);
    expect(converted.children!.map((c) => c.attrs!.text)).toEqual(['TypeScript', 'Go']);
  });

  it('converts chips back to a list', () => {
    const chips = chipsNode(['AWS', 'GCP']);
    const before = doc(rootNode([chips]));

    const { document, result } = applyPatch(before, {
      ops: [{ op: 'convertNode', id: chips.id, to: 'list' }],
    });

    expect(result.valid).toBe(true);
    const converted = document.body.children![0];
    expect(converted.type).toBe('list');
    expect(converted.children!.map((li) => li.type)).toEqual(['listItem', 'listItem']);
    // each listItem holds a paragraph > text with the original chip text
    const texts = converted.children!.map(
      (li) => li.children![0].children![0].attrs!.text,
    );
    expect(texts).toEqual(['AWS', 'GCP']);
  });

  it('does not mutate the original document', () => {
    const list = listNode(['A']);
    const before = doc(rootNode([list]));
    const snapshot = JSON.stringify(before);

    applyPatch(before, { ops: [{ op: 'convertNode', id: list.id, to: 'chips' }] });

    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe('applyPatch — content ops', () => {
  it('setAttrs merges into a node attrs (rename a chip)', () => {
    const chips = chipsNode(['Java']);
    const chipId = chips.children![0].id;
    const before = doc(rootNode([chips]));

    const { document, result } = applyPatch(before, {
      ops: [{ op: 'setAttrs', id: chipId, attrs: { text: 'Kotlin' } }],
    });

    expect(result.valid).toBe(true);
    expect(document.body.children![0].children![0].attrs!.text).toBe('Kotlin');
  });

  it('addChild appends a node and generates missing ids', () => {
    const chips = chipsNode(['Python']);
    const before = doc(rootNode([chips]));

    const { document, result } = applyPatch(before, {
      ops: [
        {
          op: 'addChild',
          parentId: chips.id,
          node: { type: 'chip', id: '', attrs: { text: 'Rust' } },
        },
      ],
    });

    expect(result.valid).toBe(true);
    const added = document.body.children![0].children!;
    expect(added.map((c) => c.attrs!.text)).toEqual(['Python', 'Rust']);
    expect(added[1].id).not.toBe(''); // id generated
  });

  it('addChild respects an explicit index', () => {
    const chips = chipsNode(['B', 'D']);
    const before = doc(rootNode([chips]));

    const { document } = applyPatch(before, {
      ops: [
        { op: 'addChild', parentId: chips.id, index: 1, node: { type: 'chip', id: '', attrs: { text: 'C' } } },
      ],
    });

    expect(document.body.children![0].children!.map((c) => c.attrs!.text)).toEqual(['B', 'C', 'D']);
  });

  it('removeNode removes a node and its subtree', () => {
    const chips = chipsNode(['Keep', 'Drop']);
    const dropId = chips.children![1].id;
    const before = doc(rootNode([chips]));

    const { document, result } = applyPatch(before, {
      ops: [{ op: 'removeNode', id: dropId }],
    });

    expect(result.valid).toBe(true);
    expect(document.body.children![0].children!.map((c) => c.attrs!.text)).toEqual(['Keep']);
  });

  it('updateHeader merges header fields', () => {
    const before = doc(rootNode([paragraphNode('hi')]));

    const { document, result } = applyPatch(before, {
      ops: [{ op: 'updateHeader', fields: { title: 'Staff Engineer' } }],
    });

    expect(result.valid).toBe(true);
    expect(document.header.title).toBe('Staff Engineer');
  });

  it('applies multiple ops in order', () => {
    const chips = chipsNode(['One']);
    const before = doc(rootNode([chips]));

    const { document, result } = applyPatch(before, {
      ops: [
        { op: 'addChild', parentId: chips.id, node: { type: 'chip', id: '', attrs: { text: 'Two' } } },
        { op: 'updateHeader', fields: { fullName: 'Ada' } },
      ],
    });

    expect(result.valid).toBe(true);
    expect(document.body.children![0].children!.length).toBe(2);
    expect(document.header.fullName).toBe('Ada');
  });
});

describe('applyPatch — atomic rejection', () => {
  it('rejects a patch that would violate the nesting schema and leaves the doc unchanged', () => {
    const before = doc(rootNode([paragraphNode('x')]));

    const { document, result } = applyPatch(before, {
      // a chip is not allowed as a direct child of root
      ops: [{ op: 'addChild', parentId: before.body.id, node: { type: 'chip', id: '', attrs: { text: 'bad' } } }],
    });

    expect(result.valid).toBe(false);
    expect(document).toEqual(before); // unchanged, no partial apply
  });

  it('rejects when a target id does not exist', () => {
    const before = doc(rootNode([paragraphNode('x')]));

    const { document, result } = applyPatch(before, {
      ops: [{ op: 'removeNode', id: 'does-not-exist' }],
    });

    expect(result.valid).toBe(false);
    expect(document).toEqual(before);
  });

  it('rejects an unknown op', () => {
    const before = doc(rootNode([paragraphNode('x')]));

    const { document, result } = applyPatch(before, {
      // @ts-expect-error — exercising the runtime guard for an unknown op
      ops: [{ op: 'frobnicate', id: before.body.id }],
    });

    expect(result.valid).toBe(false);
    expect(document).toEqual(before);
  });

  it('rejects the whole patch if a later op is invalid (no partial apply)', () => {
    const chips = chipsNode(['Stays']);
    const before = doc(rootNode([chips]));

    const { document, result } = applyPatch(before, {
      ops: [
        { op: 'addChild', parentId: chips.id, node: { type: 'chip', id: '', attrs: { text: 'New' } } },
        { op: 'removeNode', id: 'nope' }, // invalid → reject everything
      ],
    });

    expect(result.valid).toBe(false);
    expect(document).toEqual(before);
  });
});

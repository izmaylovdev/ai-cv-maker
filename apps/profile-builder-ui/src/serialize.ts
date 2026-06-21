// Serialization layer (ADR-0014 §9.4): maps the neutral BlockNode tree
// (model.ts) ⇄ Lexical's node tree. Lexical's own JSON never crosses the
// component boundary or the network — only the neutral tree does. Round-trip
// fidelity (BlockNode → Lexical → BlockNode is identity, ids included) is a hard
// requirement and is covered by serialize.test.ts.
//
// Mapping (neutral ⇄ Lexical):
//   root      ⇄ Lexical RootNode (Lexical's implicit document root)
//   section   ⇄ SectionNode            (custom; heading in attrs)
//   paragraph ⇄ PbParagraphNode        (id-carrying built-in subclass)
//   text      ⇄ PbTextNode             (id-carrying built-in subclass)
//   list      ⇄ PbListNode             (id-carrying @lexical/list subclass)
//   listItem  ⇄ PbListItemNode         (id-carrying @lexical/list subclass)
//   chips     ⇄ ChipsNode              (custom)
//   chip      ⇄ ChipNode               (custom; text in attrs)
//   timeline  ⇄ TimelineNode           (custom)
//   entry     ⇄ EntryNode              (custom; title/dates in attrs)

import {
  $getRoot,
  ElementNode,
  LexicalEditor,
  LexicalNode,
} from 'lexical';
import {
  BlockNode,
  ChipNode as ChipModel,
  ChipsNode as ChipsModel,
  EntryNode as EntryModel,
  ListItemNode as ListItemModel,
  ListNode as ListModel,
  ParagraphNode as ParagraphModel,
  RootNode,
  SectionNode as SectionModel,
  TextNode as TextModel,
  TimelineNode as TimelineModel,
} from './model';
import {
  $createChipNode,
  $createChipsNode,
  $createEntryNode,
  $createPbListItemNode,
  $createPbListNode,
  $createPbParagraphNode,
  $createPbTextNode,
  $createSectionNode,
  $createTimelineNode,
  $isChipNode,
  $isChipsNode,
  $isEntryNode,
  $isPbListItemNode,
  $isPbListNode,
  $isPbParagraphNode,
  $isPbTextNode,
  $isSectionNode,
  $isTimelineNode,
  ChipNode as LexChipNode,
  EntryNode as LexEntryNode,
  PbTextNode,
  SectionNode as LexSectionNode,
} from './lexical/widget-nodes';

// ---------------------------------------------------------------------------
// BlockNode tree → Lexical nodes
// ---------------------------------------------------------------------------

/** Build a single Lexical node (and its subtree) from a neutral BlockNode. */
export function $createLexicalNode(node: BlockNode): LexicalNode {
  switch (node.type) {
    case 'section': {
      const el = $createSectionNode(node.id, node.attrs?.['heading'] ?? '');
      appendChildren(el, node.children ?? []);
      return el;
    }
    case 'paragraph': {
      const el = $createPbParagraphNode(node.id);
      appendChildren(el, node.children ?? []);
      return el;
    }
    case 'text':
      return $createPbTextNode(node.id, node.attrs?.['text'] ?? '');
    case 'list': {
      const el = $createPbListNode(node.id);
      appendChildren(el, node.children ?? []);
      return el;
    }
    case 'listItem': {
      // Lexical holds a bullet's inline text directly, with no paragraph
      // wrapper. Flatten a leading `paragraph → text` into the list item's
      // inline text (recording its ids on the node) so it survives Lexical's
      // normalization; re-wrap it on read. Other children (nested list, chips)
      // append as block children.
      const children = node.children ?? [];
      const [first, ...rest] = children;
      let el: ReturnType<typeof $createPbListItemNode>;
      if (first && first.type === 'paragraph') {
        const textChild = first.children?.[0];
        el = $createPbListItemNode(node.id, first.id, textChild?.id);
        el.append($createPbTextNode(textChild?.id, textChild?.attrs?.['text'] ?? ''));
        appendChildren(el, rest);
      } else {
        el = $createPbListItemNode(node.id);
        appendChildren(el, children);
      }
      return el;
    }
    case 'chips': {
      const el = $createChipsNode(node.id);
      appendChildren(el, node.children ?? []);
      return el;
    }
    case 'chip':
      return $createChipNode(node.id, node.attrs?.['text'] ?? '');
    case 'timeline': {
      const el = $createTimelineNode(node.id);
      appendChildren(el, node.children ?? []);
      return el;
    }
    case 'entry': {
      const el = $createEntryNode(
        node.id,
        node.attrs?.['title'] ?? '',
        node.attrs?.['dates'] ?? '',
      );
      appendChildren(el, node.children ?? []);
      return el;
    }
    default:
      // Unknown types are dropped rather than producing a raw-HTML escape hatch.
      throw new Error(`Cannot serialize unknown node type "${(node as BlockNode).type}"`);
  }
}

function appendChildren(parent: ElementNode, children: BlockNode[]): void {
  for (const child of children) {
    parent.append($createLexicalNode(child));
  }
}

/**
 * Replace the editor's content with the Lexical equivalent of `body`. Must be
 * called inside an `editor.update(...)` callback (or use {@link loadDocument}).
 */
export function $writeBody(body: RootNode): void {
  const root = $getRoot();
  root.clear();
  for (const section of body.children ?? []) {
    root.append($createLexicalNode(section));
  }
}

/** Convenience: load a body tree into an editor via a single update. */
export function loadDocument(editor: LexicalEditor, body: RootNode): void {
  editor.update(
    () => {
      $writeBody(body);
    },
    { discrete: true },
  );
}

// ---------------------------------------------------------------------------
// Lexical nodes → BlockNode tree
// ---------------------------------------------------------------------------

/** Read a single Lexical node into a neutral BlockNode (or null to skip it). */
function readLexicalNode(node: LexicalNode): BlockNode | null {
  if ($isSectionNode(node)) {
    const n = node as LexSectionNode;
    return {
      type: 'section',
      id: n.getNodeId(),
      attrs: { heading: n.getHeading() },
      children: readChildren(n) as SectionModel['children'],
    } satisfies SectionModel;
  }
  if ($isPbParagraphNode(node)) {
    return {
      type: 'paragraph',
      id: node.getNodeId(),
      children: readChildren(node) as TextModel[],
    } satisfies ParagraphModel;
  }
  if ($isPbTextNode(node)) {
    const n = node as PbTextNode;
    return {
      type: 'text',
      id: n.getNodeId(),
      attrs: { text: n.getTextContent() },
    } satisfies TextModel;
  }
  if ($isPbListNode(node)) {
    return {
      type: 'list',
      id: node.getNodeId(),
      children: readChildren(node) as ListItemModel[],
    } satisfies ListModel;
  }
  if ($isPbListItemNode(node)) {
    // Re-wrap the list item's leading inline text back into a `paragraph →
    // text` (the inverse of the flatten on write), using the ids stashed on the
    // node. Block children (nested list, chips) map normally.
    const out: ListItemModel['children'] = [];
    const inlineText: string[] = [];
    let hasInline = false;
    for (const child of node.getChildren()) {
      if ($isPbTextNode(child)) {
        hasInline = true;
        inlineText.push(child.getTextContent());
      } else {
        const mapped = readLexicalNode(child);
        if (mapped) out.push(mapped as ListItemModel['children'][number]);
      }
    }
    if (hasInline) {
      const para: ParagraphModel = {
        type: 'paragraph',
        id: node.getParaId(),
        children: [{ type: 'text', id: node.getParaTextId(), attrs: { text: inlineText.join('') } }],
      };
      out.unshift(para);
    }
    return {
      type: 'listItem',
      id: node.getNodeId(),
      children: out,
    } satisfies ListItemModel;
  }
  if ($isChipsNode(node)) {
    return {
      type: 'chips',
      id: node.getNodeId(),
      children: readChildren(node) as ChipModel[],
    } satisfies ChipsModel;
  }
  if ($isChipNode(node)) {
    const n = node as LexChipNode;
    return {
      type: 'chip',
      id: n.getNodeId(),
      attrs: { text: n.getChipText() },
    } satisfies ChipModel;
  }
  if ($isTimelineNode(node)) {
    return {
      type: 'timeline',
      id: node.getNodeId(),
      children: readChildren(node) as EntryModel[],
    } satisfies TimelineModel;
  }
  if ($isEntryNode(node)) {
    const n = node as LexEntryNode;
    return {
      type: 'entry',
      id: n.getNodeId(),
      attrs: { title: n.getTitle(), dates: n.getDates() },
      children: readChildren(n) as EntryModel['children'],
    } satisfies EntryModel;
  }
  // Unknown/foreign node (e.g. a plain Lexical paragraph from a paste): skip it.
  return null;
}

function readChildren(node: LexicalNode): BlockNode[] {
  if (!(node instanceof ElementNode)) return [];
  const out: BlockNode[] = [];
  for (const child of node.getChildren()) {
    const mapped = readLexicalNode(child);
    if (mapped) out.push(mapped);
  }
  return out;
}

/**
 * Read the current editor content into a neutral body tree. Must be called
 * inside `editorState.read(...)` (or use {@link readDocument}). The implicit
 * Lexical root maps to our `root` node; only `section` children survive (other
 * top-level nodes are skipped, per the §9.3 matrix).
 */
export function $readBody(rootId: string): RootNode {
  const root = $getRoot();
  const children: SectionModel[] = [];
  for (const child of root.getChildren()) {
    const mapped = readLexicalNode(child);
    if (mapped && mapped.type === 'section') children.push(mapped as SectionModel);
  }
  return { type: 'root', id: rootId, children };
}

/**
 * Convenience: read an editor's current state into a body tree. `rootId`
 * preserves the neutral root node's id across the round trip (Lexical's own
 * root has no stable id of ours).
 */
export function readDocument(editor: LexicalEditor, rootId: string): RootNode {
  return editor.getEditorState().read(() => $readBody(rootId));
}

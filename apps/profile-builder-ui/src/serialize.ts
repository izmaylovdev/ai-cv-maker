// Serialization layer (ADR-0014 §9.4): maps the neutral BlockNode tree
// (model.ts) ⇄ Lexical's node tree. Lexical's own JSON never crosses the
// component boundary or the network — only the neutral tree does. Round-trip
// fidelity (BlockNode → Lexical → BlockNode is identity for neutral ids) is a
// hard requirement covered by serialize.test.ts.
//
// Structured widgets keep their leaf data in dedicated places that the editor
// can edit natively, and this layer bridges them back to the neutral `attrs`:
//   section  → SectionNode + a SectionHeadingNode child (heading text)
//   entry    → EntryNode + title/dates EntryFieldNode children, then description
//   chips    → ChipsNode decorator state ({id,text}[]) ⇄ `chip` children
//   paragraph/text/list/listItem → id-carrying Lexical built-ins

import { $getRoot, ElementNode, LexicalEditor, LexicalNode } from 'lexical';
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
  $createChipsNode,
  $createEntryFieldNode,
  $createEntryNode,
  $createPbListItemNode,
  $createPbListNode,
  $createPbParagraphNode,
  $createPbTextNode,
  $createSectionHeadingNode,
  $createSectionNode,
  $createTimelineNode,
  $isChipsNode,
  $isEntryFieldNode,
  $isEntryNode,
  $isPbListItemNode,
  $isPbListNode,
  $isPbParagraphNode,
  $isPbTextNode,
  $isSectionHeadingNode,
  $isSectionNode,
  $isTimelineNode,
  ChipsNode as LexChipsNode,
  EntryFieldNode,
  PbTextNode,
} from './lexical/widget-nodes';

// ---------------------------------------------------------------------------
// BlockNode tree → Lexical nodes
// ---------------------------------------------------------------------------

/** Build a single Lexical node (and its subtree) from a neutral BlockNode. */
export function $createLexicalNode(node: BlockNode): LexicalNode {
  switch (node.type) {
    case 'section': {
      const el = $createSectionNode(node.id);
      const heading = $createSectionHeadingNode();
      heading.append($createPbTextNode(undefined, node.attrs?.['heading'] ?? ''));
      el.append(heading);
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
      // Flatten a leading `paragraph → text` into the item's inline text (Lexical
      // holds it directly); re-wrap on read. Other children append as blocks.
      const children = node.children ?? [];
      const [first, ...rest] = children;
      if (first && first.type === 'paragraph') {
        const textChild = first.children?.[0];
        const el = $createPbListItemNode(node.id, first.id, textChild?.id);
        el.append($createPbTextNode(textChild?.id, textChild?.attrs?.['text'] ?? ''));
        appendChildren(el, rest);
        return el;
      }
      const el = $createPbListItemNode(node.id);
      appendChildren(el, children);
      return el;
    }
    case 'chips': {
      const chips = (node.children ?? []).map((c) => ({ id: c.id, text: c.attrs?.['text'] ?? '' }));
      return $createChipsNode(node.id, chips);
    }
    case 'timeline': {
      const el = $createTimelineNode(node.id);
      appendChildren(el, node.children ?? []);
      return el;
    }
    case 'entry': {
      const el = $createEntryNode(node.id);
      const title = $createEntryFieldNode('title');
      title.append($createPbTextNode(undefined, node.attrs?.['title'] ?? ''));
      const dates = $createEntryFieldNode('dates');
      dates.append($createPbTextNode(undefined, node.attrs?.['dates'] ?? ''));
      el.append(title);
      el.append(dates);
      appendChildren(el, node.children ?? []);
      return el;
    }
    default:
      throw new Error(`Cannot serialize unknown node type "${(node as BlockNode).type}"`);
  }
}

function appendChildren(parent: ElementNode, children: BlockNode[]): void {
  for (const child of children) {
    parent.append($createLexicalNode(child));
  }
}

/** Replace the editor's content with the Lexical equivalent of `body`. */
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

/** Map an element's children to neutral nodes, skipping any the predicate hides. */
function readChildren(node: LexicalNode, skip?: (n: LexicalNode) => boolean): BlockNode[] {
  if (!(node instanceof ElementNode)) return [];
  const out: BlockNode[] = [];
  for (const child of node.getChildren()) {
    if (skip?.(child)) continue;
    const mapped = readLexicalNode(child);
    if (mapped) out.push(mapped);
  }
  return out;
}

/** Read a single Lexical node into a neutral BlockNode (or null to skip it). */
function readLexicalNode(node: LexicalNode): BlockNode | null {
  if ($isSectionNode(node)) {
    const headingEl = node.getChildren().find($isSectionHeadingNode);
    return {
      type: 'section',
      id: node.getNodeId(),
      attrs: { heading: headingEl ? headingEl.getTextContent() : '' },
      children: readChildren(node, $isSectionHeadingNode) as SectionModel['children'],
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
    return { type: 'text', id: n.getNodeId(), attrs: { text: n.getTextContent() } } satisfies TextModel;
  }
  if ($isPbListNode(node)) {
    return {
      type: 'list',
      id: node.getNodeId(),
      children: readChildren(node) as ListItemModel[],
    } satisfies ListModel;
  }
  if ($isPbListItemNode(node)) {
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
      out.unshift({
        type: 'paragraph',
        id: node.getParaId(),
        children: [{ type: 'text', id: node.getParaTextId(), attrs: { text: inlineText.join('') } }],
      });
    }
    return { type: 'listItem', id: node.getNodeId(), children: out } satisfies ListItemModel;
  }
  if ($isChipsNode(node)) {
    const n = node as LexChipsNode;
    return {
      type: 'chips',
      id: n.getNodeId(),
      children: n.getChips().map(
        (c): ChipModel => ({ type: 'chip', id: c.id, attrs: { text: c.text } }),
      ),
    } satisfies ChipsModel;
  }
  if ($isTimelineNode(node)) {
    return {
      type: 'timeline',
      id: node.getNodeId(),
      children: readChildren(node) as EntryModel[],
    } satisfies TimelineModel;
  }
  if ($isEntryNode(node)) {
    const fields = node.getChildren().filter($isEntryFieldNode) as EntryFieldNode[];
    const titleEl = fields.find((f) => f.getField() === 'title');
    const datesEl = fields.find((f) => f.getField() === 'dates');
    return {
      type: 'entry',
      id: node.getNodeId(),
      attrs: { title: titleEl?.getTextContent() ?? '', dates: datesEl?.getTextContent() ?? '' },
      children: readChildren(node, $isEntryFieldNode) as EntryModel['children'],
    } satisfies EntryModel;
  }
  // Unknown/foreign node (e.g. a plain Lexical node from a paste): skip it.
  return null;
}

/** Read the current editor content into a neutral body tree. */
export function $readBody(rootId: string): RootNode {
  const root = $getRoot();
  const children: SectionModel[] = [];
  for (const child of root.getChildren()) {
    const mapped = readLexicalNode(child);
    if (mapped && mapped.type === 'section') children.push(mapped as SectionModel);
  }
  return { type: 'root', id: rootId, children };
}

/** Convenience: read an editor's current state into a body tree. */
export function readDocument(editor: LexicalEditor, rootId: string): RootNode {
  return editor.getEditorState().read(() => $readBody(rootId));
}

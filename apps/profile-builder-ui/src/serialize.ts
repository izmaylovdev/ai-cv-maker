// Serialization layer (ADR-0014 §9.4 / §13.2.4): maps the neutral BlockNode tree
// (model.ts) ⇄ Lexical's node tree. Lexical's own JSON never crosses the
// component boundary or the network — only the neutral tree does. Round-trip
// fidelity (BlockNode → Lexical → BlockNode is identity for neutral ids) is a
// hard requirement covered by serialize.test.ts.
//
// Legacy migration (F-EDIT-19.8): $writeBody recognises `section` nodes in the
// incoming neutral tree and converts them in-place to a PbTitleNode (carrying the
// heading text) followed by the section's former children, all appended flat to
// root. The neutral tree emitted by onChange is already in the new flat shape, so
// the first save after opening a legacy document upgrades it transparently.

import { $getRoot, ElementNode, LexicalEditor, LexicalNode } from 'lexical';
import {
  BlockNode,
  ChipNode as ChipModel,
  ChipsNode as ChipsModel,
  EntryNode as EntryModel,
  FlowNode,
  InlineLinkNode as InlineLinkModel,
  LinkNode as LinkModel,
  ListItemNode as ListItemModel,
  ListNode as ListModel,
  ParagraphNode as ParagraphModel,
  RootNode,
  TextNode as TextModel,
  TimelineNode as TimelineModel,
  TitleNode as TitleModel,
} from './model';
import {
  $createChipsNode,
  $createEntryFieldNode,
  $createEntryNode,
  $createInlineLinkNode,
  $createLinkNode,
  $createPbListItemNode,
  $createPbListNode,
  $createPbParagraphNode,
  $createPbTextNode,
  $createTitleNode,
  $isChipsNode,
  $isEntryFieldNode,
  $isEntryNode,
  $isInlineLinkNode,
  $isLinkNode,
  $isPbListItemNode,
  $isPbListNode,
  $isPbParagraphNode,
  $isPbTextNode,
  $isTitleNode,
  $isTimelineNode,
  $createTimelineNode,
  ChipsNode as LexChipsNode,
  EntryFieldNode,
  PbInlineLinkNode,
  PbTextNode,
} from './lexical/widget-nodes';

// ---------------------------------------------------------------------------
// BlockNode tree → Lexical nodes
// ---------------------------------------------------------------------------

/** Build a single Lexical node (and its subtree) from a neutral BlockNode. */
export function $createLexicalNode(node: BlockNode): LexicalNode {
  switch (node.type) {
    case 'title': {
      const el = $createTitleNode(node.id);
      el.append($createPbTextNode(undefined, node.attrs?.['text'] ?? ''));
      return el;
    }
    case 'paragraph': {
      const el = $createPbParagraphNode(node.id);
      appendChildren(el, node.children ?? []);
      return el;
    }
    case 'text':
      return $createPbTextNode(node.id, node.attrs?.['text'] ?? '');
    case 'inlineLink': {
      const link = $createInlineLinkNode(node.attrs?.['url'] ?? '', node.id);
      link.append($createPbTextNode(undefined, node.attrs?.['text'] ?? ''));
      return link;
    }
    case 'link':
      return $createLinkNode(node.id, node.attrs?.['text'] ?? '', node.attrs?.['url'] ?? '');
    case 'list': {
      const el = $createPbListNode(node.id);
      appendChildren(el, node.children ?? []);
      return el;
    }
    case 'listItem': {
      const children = node.children ?? [];
      const [first, ...rest] = children;
      if (first && first.type === 'paragraph') {
        // Lexical holds a bullet's inline content directly on the list item (no
        // paragraph wrapper); flatten the leading paragraph's runs (text +
        // inline links) onto the item, then append any nested blocks.
        const runs = first.children ?? [];
        const firstRun = runs[0];
        const el = $createPbListItemNode(node.id, first.id, firstRun?.type === 'text' ? firstRun.id : undefined);
        appendChildren(el, runs);
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

/**
 * Replace the editor's content with the Lexical equivalent of `body`.
 * Handles legacy `section` nodes (F-EDIT-19.8): each section is expanded to
 * a PbTitleNode (heading text) followed by its former children, all flat at root.
 */
export function $writeBody(body: RootNode): void {
  const root = $getRoot();
  root.clear();
  for (const child of body.children ?? []) {
    if ((child as { type: string }).type === 'section') {
      // Legacy migration: section → title + flat children.
      const heading = (child as BlockNode).attrs?.['heading'] ?? '';
      const titleEl = $createTitleNode(child.id);
      titleEl.append($createPbTextNode(undefined, heading));
      root.append(titleEl);
      for (const flowChild of (child as BlockNode).children ?? []) {
        root.append($createLexicalNode(flowChild as FlowNode));
      }
    } else {
      root.append($createLexicalNode(child));
    }
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

/** An inline link node → its neutral `inlineLink` run (label = its text content). */
function inlineLinkToModel(node: PbInlineLinkNode): InlineLinkModel {
  return {
    type: 'inlineLink',
    id: node.getNodeId(),
    attrs: { text: node.getTextContent(), url: node.getURL() },
  };
}

/** Read a single Lexical node into a neutral BlockNode (or null to skip it). */
function readLexicalNode(node: LexicalNode): BlockNode | null {
  if ($isTitleNode(node)) {
    return {
      type: 'title',
      id: node.getNodeId(),
      attrs: { text: node.getTextContent() },
    } satisfies TitleModel;
  }
  if ($isPbParagraphNode(node)) {
    return {
      type: 'paragraph',
      id: node.getNodeId(),
      children: readChildren(node) as ParagraphModel['children'],
    } satisfies ParagraphModel;
  }
  if ($isPbTextNode(node)) {
    const n = node as PbTextNode;
    return { type: 'text', id: n.getNodeId(), attrs: { text: n.getTextContent() } } satisfies TextModel;
  }
  if ($isInlineLinkNode(node)) {
    return inlineLinkToModel(node);
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
    const inlineRuns: ParagraphModel['children'] = [];
    let hasInline = false;
    for (const child of node.getChildren()) {
      if ($isPbTextNode(child)) {
        hasInline = true;
        inlineRuns.push({ type: 'text', id: child.getNodeId(), attrs: { text: child.getTextContent() } });
      } else if ($isInlineLinkNode(child)) {
        hasInline = true;
        inlineRuns.push(inlineLinkToModel(child));
      } else {
        const mapped = readLexicalNode(child);
        if (mapped) out.push(mapped as ListItemModel['children'][number]);
      }
    }
    if (hasInline) {
      // Re-wrap the item's inline runs in the neutral model's paragraph→text shape.
      out.unshift({ type: 'paragraph', id: node.getParaId(), children: inlineRuns });
    }
    return { type: 'listItem', id: node.getNodeId(), children: out } satisfies ListItemModel;
  }
  if ($isLinkNode(node)) {
    return {
      type: 'link',
      id: node.getNodeId(),
      attrs: { text: node.getText(), url: node.getUrl() },
    } satisfies LinkModel;
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

/** Read the current editor content into a neutral flat body tree. */
export function $readBody(rootId: string): RootNode {
  const root = $getRoot();
  const children: (TitleModel | FlowNode)[] = [];
  for (const child of root.getChildren()) {
    const mapped = readLexicalNode(child);
    if (mapped) children.push(mapped as TitleModel | FlowNode);
  }
  return { type: 'root', id: rootId, children };
}

/** Convenience: read an editor's current state into a body tree. */
export function readDocument(editor: LexicalEditor, rootId: string): RootNode {
  return editor.getEditorState().read(() => $readBody(rootId));
}

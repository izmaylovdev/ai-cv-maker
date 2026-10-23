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
// Legacy standalone `link` blocks get the same treatment: they load as a
// paragraph holding one inline link (model.ts `migrateLegacyLinks`).
//
// Inline links are the stock @lexical/link LinkNode (AutoLinkNode for typed or
// pasted URLs); the neutral `inlineLink.id` is carried in its NodeState.

import { $createLinkNode, $isAutoLinkNode, $isLinkNode, LinkNode } from '@lexical/link';
import { $getRoot, ElementNode, LexicalEditor, LexicalNode } from 'lexical';
import {
  BlockNode,
  ChipNode as ChipModel,
  ChipsNode as ChipsModel,
  EntryNode as EntryModel,
  FlowNode,
  InlineLinkNode as InlineLinkModel,
  ListItemNode as ListItemModel,
  ListNode as ListModel,
  ParagraphNode as ParagraphModel,
  RootNode,
  TextNode as TextModel,
  TimelineNode as TimelineModel,
  TitleNode as TitleModel,
  migrateLegacyLinks,
  newId,
} from './model';
import {
  $createChipsNode,
  $createEntryFieldNode,
  $createEntryNode,
  $createPbListItemNode,
  $createPbListNode,
  $createPbParagraphNode,
  $createPbTextNode,
  $createTitleNode,
  $isChipsNode,
  $isEntryFieldNode,
  $isEntryNode,
  $isPbListItemNode,
  $isPbListNode,
  $isPbParagraphNode,
  $isPbTextNode,
  $isTitleNode,
  $isTimelineNode,
  $createTimelineNode,
  $getLinkId,
  $setLinkId,
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
      const url = node.attrs?.['url'] ?? '';
      const link = $createLinkNode(url);
      $setLinkId(link, node.id || newId());
      // A label-less link would render invisible; fall back to the url.
      link.append($createPbTextNode(undefined, node.attrs?.['text'] || url));
      return link;
    }
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
        // ListItemNode.append merges a paragraph's children into the item, which
        // would fold a later paragraph (e.g. a migrated legacy link) into the
        // leading runs. ElementNode.splice inserts the block as-is.
        for (const child of rest) el.splice(el.getChildrenSize(), 0, [$createLexicalNode(child)]);
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
 * Handles legacy `link` blocks at any depth: each becomes a paragraph (keeping
 * the link's id) holding one inline link.
 */
export function $writeBody(body: RootNode): void {
  const root = $getRoot();
  root.clear();
  for (const child of migrateLegacyLinks(body).children ?? []) {
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

/** A link node → its neutral `inlineLink` run (label = its text content). */
function inlineLinkToModel(node: LinkNode): InlineLinkModel {
  return {
    type: 'inlineLink',
    // Every link gets an id from the editor's transform (registerLinkIds); the
    // key fallback only covers a bare editor that never registered it.
    id: $getLinkId(node) || `link-${node.getKey()}`,
    attrs: { text: node.getTextContent(), url: node.getURL() },
  };
}

/**
 * Read a run of inline children (a paragraph's, or a list item's leading text)
 * into neutral `text` / `inlineLink` runs. An autolink the user unlinked
 * (rendered as plain text) reads back as its text runs.
 *
 * Empty text runs are dropped when the block has other runs: committing a link
 * leaves an empty run after it as the caret's landing spot, and it carries no
 * content. A block holding only an empty run keeps it.
 */
function readInlineRuns(children: LexicalNode[]): (TextModel | InlineLinkModel)[] {
  const runs: (TextModel | InlineLinkModel)[] = [];
  for (const child of children) {
    if ($isPbTextNode(child)) {
      runs.push({ type: 'text', id: child.getNodeId(), attrs: { text: child.getTextContent() } });
    } else if ($isAutoLinkNode(child) && child.getIsUnlinked()) {
      runs.push(...readInlineRuns(child.getChildren()));
    } else if ($isLinkNode(child)) {
      runs.push(inlineLinkToModel(child));
    }
  }
  const content = runs.filter((r) => r.type !== 'text' || r.attrs.text !== '');
  return content.length > 0 ? content : runs.slice(0, 1);
}

/** Whether `node` is inline content of a paragraph / list item (a run). */
function isInlineRun(node: LexicalNode): boolean {
  return $isPbTextNode(node) || $isLinkNode(node);
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
      children: readInlineRuns(node.getChildren()),
    } satisfies ParagraphModel;
  }
  if ($isPbTextNode(node)) {
    const n = node as PbTextNode;
    return { type: 'text', id: n.getNodeId(), attrs: { text: n.getTextContent() } } satisfies TextModel;
  }
  if ($isLinkNode(node)) {
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
    const inline = node.getChildren().filter(isInlineRun);
    for (const child of node.getChildren()) {
      if (isInlineRun(child)) continue;
      const mapped = readLexicalNode(child);
      if (mapped) out.push(mapped as ListItemModel['children'][number]);
    }
    if (inline.length > 0) {
      // Re-wrap the item's inline runs in the neutral model's paragraph→text shape.
      out.unshift({ type: 'paragraph', id: node.getParaId(), children: readInlineRuns(inline) });
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

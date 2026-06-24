// Canonical profile document model (ADR-0014, amends ADR-0013). Plain, JSON-safe,
// editor-independent shapes. This is the persisted `Profile.Document` shape end
// to end — cv-api stores it as a JSON column, the gRPC proto (recursive
// ProfileNode) and llm-service mirror it, and the PDF renders it via a recursive
// tree walk. Lexical's own serialization is NEVER persisted (see serialize.ts);
// only this neutral tree crosses the web-component boundary and the network.
//
// This TypeScript definition is the REFERENCE; keep the C# CvApi.Domain and
// Python app/schemas.py in sync. Spec §9.2 / §9.3 / §13.

/** Closed set of node types — no other `type` is valid, and there is no raw HTML. */
export type NodeType =
  | 'root'
  | 'title'
  | 'paragraph'
  | 'text'
  | 'link'
  | 'list'
  | 'listItem'
  | 'chips'
  | 'chip'
  | 'timeline'
  | 'entry';

/**
 * A node in the profile body tree. Every node is `{ type, id, attrs?, children? }`.
 * `attrs` holds type-specific leaf data (e.g. `text.attrs.text`,
 * `title.attrs.text`, `entry.attrs.dates`). `children` is ordered and the
 * array order IS document order.
 */
export interface BlockNode {
  type: NodeType;
  /** Stable, client-generated id — the reorder / diff / AI-patch key. */
  id: string;
  attrs?: Record<string, string>;
  children?: BlockNode[];
}

// Narrowed convenience aliases for each node type (spec §9.2 / §13.2.1).
export type RootNode = BlockNode & { type: 'root'; children: (TitleNode | FlowNode)[] };
/** A section heading. Leaf — no children. Groups all non-title blocks that follow it until the next TitleNode. */
export type TitleNode = BlockNode & { type: 'title'; attrs: { text: string } };
export type FlowNode = ParagraphNode | ListNode | ChipsNode | TimelineNode | LinkNode;
export type ParagraphNode = BlockNode & { type: 'paragraph'; children: TextNode[] };
/** Leaf; plain string (marks are out of scope, spec §9.6). */
export type TextNode = BlockNode & { type: 'text'; attrs: { text: string } };
/** Leaf; a standalone link line with display text + url (spec §10, NOT an inline mark). */
export type LinkNode = BlockNode & { type: 'link'; attrs: { text: string; url: string } };
export type ListNode = BlockNode & { type: 'list'; children: ListItemNode[] };
export type ListItemNode = BlockNode & {
  type: 'listItem';
  children: (ParagraphNode | ListNode | ChipsNode | LinkNode)[];
};
export type ChipsNode = BlockNode & { type: 'chips'; children: ChipNode[] };
/** Leaf; short plain string. */
export type ChipNode = BlockNode & { type: 'chip'; attrs: { text: string } };
export type TimelineNode = BlockNode & { type: 'timeline'; children: EntryNode[] };
export type EntryNode = BlockNode & {
  type: 'entry';
  attrs: { title: string; dates: string };
  children: (ParagraphNode | ListNode | LinkNode)[];
};

export interface ProfileDocument {
  /** Fixed identity/contact letterhead, outside the rich-text tree (§7.2). */
  header: ProfileHeader;
  /** Single rich-text block tree. */
  body: RootNode;
}

/**
 * The document's letterhead: identity and contact details. Fixed (not
 * addable/removable/reorderable) — every CV needs it, and the persisted Profile
 * and PDF renderer depend on these fields.
 */
export interface ProfileHeader {
  fullName: string;
  /** Professional headline / job title, e.g. "Senior Software Engineer". */
  title: string;
  email: string;
  phone: string;
  location: string;
}

/** Collision-resistant id generator with a fallback for non-secure contexts. */
export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function emptyHeader(): ProfileHeader {
  return { fullName: '', title: '', email: '', phone: '', location: '' };
}

export function emptyDocument(): ProfileDocument {
  return { header: emptyHeader(), body: { type: 'root', id: newId(), children: [] } };
}

// ---------------------------------------------------------------------------
// Schema / nesting matrix (spec §9.3 / §13.2.1)
// ---------------------------------------------------------------------------

/**
 * Allowed child types for each node type. Empty array = leaf (no children).
 * This is the single source of truth for the nesting matrix; the editor cannot
 * author violations, cv-api rejects them on write, and the PDF walk may assume
 * them.
 */
export const ALLOWED_CHILDREN: Record<NodeType, NodeType[]> = {
  root: ['title', 'paragraph', 'list', 'chips', 'timeline', 'link'],
  title: [],
  paragraph: ['text'],
  text: [],
  link: [],
  list: ['listItem'],
  listItem: ['paragraph', 'list', 'chips', 'link'],
  chips: ['chip'],
  chip: [],
  timeline: ['entry'],
  entry: ['paragraph', 'list', 'link'],
};

/** Required `attrs` keys per node type (each value must be a string). */
const REQUIRED_ATTRS: Partial<Record<NodeType, string[]>> = {
  title: ['text'],
  text: ['text'],
  link: ['text', 'url'],
  chip: ['text'],
  entry: ['title', 'dates'],
};

/** Default maximum nesting depth, counted in flow levels (spec §9.3). */
export const DEFAULT_MAX_DEPTH = 4;

export interface ValidationOptions {
  /** Maximum flow nesting depth (default {@link DEFAULT_MAX_DEPTH}). */
  maxDepth?: number;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const ALL_TYPES = new Set<NodeType>(Object.keys(ALLOWED_CHILDREN) as NodeType[]);

/**
 * Validate a `BlockNode` tree against the §9.3 / §13 schema: closed type set, the
 * allowed-children matrix, required `attrs`, and a bounded flow depth.
 */
export function validateDocument(
  doc: ProfileDocument,
  options: ValidationOptions = {},
): ValidationResult {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const errors: string[] = [];

  if (!doc || typeof doc !== 'object') {
    return { valid: false, errors: ['document is not an object'] };
  }
  if (!doc.header || typeof doc.header !== 'object') {
    errors.push('document.header is missing');
  }
  if (!doc.body) {
    errors.push('document.body is missing');
    return { valid: false, errors };
  }
  if (doc.body.type !== 'root') {
    errors.push(`document.body must be a root node, got "${doc.body.type}"`);
  }

  const FLOW_CONTAINERS = new Set<NodeType>(['list', 'timeline']);
  const seenIds = new Set<string>();

  const visit = (node: BlockNode, parent: NodeType | null, depth: number) => {
    if (!node || typeof node !== 'object') {
      errors.push('encountered a non-object node');
      return;
    }
    if (!ALL_TYPES.has(node.type)) {
      errors.push(`unknown node type "${node.type}"`);
      return;
    }
    if (typeof node.id !== 'string' || node.id.length === 0) {
      errors.push(`node of type "${node.type}" is missing a string id`);
    } else if (seenIds.has(node.id)) {
      errors.push(`duplicate node id "${node.id}"`);
    } else {
      seenIds.add(node.id);
    }

    const required = REQUIRED_ATTRS[node.type];
    if (required) {
      for (const key of required) {
        if (typeof node.attrs?.[key] !== 'string') {
          errors.push(`node "${node.type}" (${node.id}) is missing required attr "${key}"`);
        }
      }
    }

    if (parent !== null && !ALLOWED_CHILDREN[parent].includes(node.type)) {
      errors.push(`"${node.type}" is not allowed inside "${parent}"`);
    }

    const allowed = ALLOWED_CHILDREN[node.type];
    const children = node.children ?? [];
    if (allowed.length === 0 && children.length > 0) {
      errors.push(`leaf node "${node.type}" (${node.id}) must not have children`);
    }

    const nextDepth = FLOW_CONTAINERS.has(node.type) ? depth + 1 : depth;
    if (nextDepth > maxDepth) {
      errors.push(`nesting depth exceeds max of ${maxDepth} at "${node.type}" (${node.id})`);
      return;
    }

    for (const child of children) {
      visit(child, node.type, nextDepth);
    }
  };

  visit(doc.body, null, 0);

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Patch / apply (US-AI-9, spec §6.4) — structured AI-chat edits.
// ---------------------------------------------------------------------------

/**
 * A single edit operation, addressed by stable `BlockNode.id` (or `parentId`).
 * Closed set — see spec §6.4.
 */
export type PatchOp =
  | { op: 'convertNode'; id: string; to: 'chips' | 'list' }
  | { op: 'setAttrs'; id: string; attrs: Record<string, string> }
  | { op: 'addChild'; parentId: string; index?: number; node: BlockNode }
  | { op: 'removeNode'; id: string }
  | { op: 'updateHeader'; fields: Partial<ProfileHeader> };

export interface DocumentPatch {
  ops: PatchOp[];
}

class PatchError extends Error {}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Assign a fresh id to any node (recursively) that is missing one. */
function ensureIds(node: BlockNode): BlockNode {
  const next: BlockNode = { ...node, id: node.id || newId() };
  if (node.children) next.children = node.children.map(ensureIds);
  return next;
}

interface Located {
  node: BlockNode;
  parent: BlockNode | null;
  index: number;
}

/** Depth-first lookup of a node by id, with its parent and child index. */
function locate(root: BlockNode, id: string): Located | null {
  if (root.id === id) return { node: root, parent: null, index: -1 };
  const stack: { node: BlockNode }[] = [{ node: root }];
  while (stack.length) {
    const { node } = stack.pop()!;
    const children = node.children ?? [];
    for (let i = 0; i < children.length; i++) {
      if (children[i].id === id) return { node: children[i], parent: node, index: i };
      stack.push({ node: children[i] });
    }
  }
  return null;
}

/** Concatenated text of the leading paragraph inside a listItem (or ''). */
function leadingText(item: BlockNode): string {
  const paragraph = (item.children ?? []).find((c) => c.type === 'paragraph');
  if (!paragraph) return '';
  return (paragraph.children ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.attrs?.text ?? '')
    .join('');
}

function listToChips(list: BlockNode): BlockNode {
  return {
    type: 'chips',
    id: newId(),
    children: (list.children ?? []).map((item) => ({
      type: 'chip',
      id: newId(),
      attrs: { text: leadingText(item) },
    })),
  };
}

function chipsToList(chips: BlockNode): BlockNode {
  return {
    type: 'list',
    id: newId(),
    children: (chips.children ?? []).map((chip) => ({
      type: 'listItem',
      id: newId(),
      children: [
        {
          type: 'paragraph',
          id: newId(),
          children: [{ type: 'text', id: newId(), attrs: { text: chip.attrs?.text ?? '' } }],
        },
      ],
    })),
  };
}

/** Apply one op in place to `doc`. Throws {@link PatchError} on a bad target/op. */
function applyOp(doc: ProfileDocument, op: PatchOp): void {
  switch (op.op) {
    case 'updateHeader': {
      doc.header = { ...doc.header, ...op.fields };
      return;
    }
    case 'setAttrs': {
      const found = locate(doc.body, op.id);
      if (!found) throw new PatchError(`node "${op.id}" not found`);
      found.node.attrs = { ...(found.node.attrs ?? {}), ...op.attrs };
      return;
    }
    case 'removeNode': {
      const found = locate(doc.body, op.id);
      if (!found || !found.parent) throw new PatchError(`node "${op.id}" not found or not removable`);
      found.parent.children!.splice(found.index, 1);
      return;
    }
    case 'addChild': {
      const parent = locate(doc.body, op.parentId);
      if (!parent) throw new PatchError(`parent "${op.parentId}" not found`);
      const children = parent.node.children ?? (parent.node.children = []);
      const index = op.index ?? children.length;
      children.splice(index, 0, ensureIds(op.node));
      return;
    }
    case 'convertNode': {
      const found = locate(doc.body, op.id);
      if (!found || !found.parent) throw new PatchError(`node "${op.id}" not found or not convertible`);
      let replacement: BlockNode;
      if (op.to === 'chips' && found.node.type === 'list') replacement = listToChips(found.node);
      else if (op.to === 'list' && found.node.type === 'chips') replacement = chipsToList(found.node);
      else throw new PatchError(`cannot convert "${found.node.type}" to "${op.to}"`);
      found.parent.children![found.index] = replacement;
      return;
    }
    default:
      throw new PatchError(`unknown op "${(op as { op: string }).op}"`);
  }
}

/**
 * Apply an ordered patch to a clone of `doc`, then validate (US-AI-9 §6.4 /
 * F-CHAT-6.9). The patch is **atomic**: if any op targets a missing node, is
 * unknown, or the result fails {@link validateDocument}, the ORIGINAL document
 * is returned unchanged with `result.valid === false`.
 */
export function applyPatch(
  doc: ProfileDocument,
  patch: DocumentPatch,
  options: ValidationOptions = {},
): { document: ProfileDocument; result: ValidationResult } {
  const working = clone(doc);
  try {
    for (const op of patch?.ops ?? []) applyOp(working, op);
  } catch (e) {
    return { document: doc, result: { valid: false, errors: [(e as Error).message] } };
  }
  const result = validateDocument(working, options);
  if (!result.valid) return { document: doc, result };
  return { document: working, result };
}

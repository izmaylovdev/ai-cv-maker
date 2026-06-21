// Canonical profile document model (ADR-0014, amends ADR-0013). Plain, JSON-safe,
// editor-independent shapes. This is the persisted `Profile.Document` shape end
// to end — cv-api stores it as a JSON column, the gRPC proto (recursive
// ProfileNode) and llm-service mirror it, and the PDF renders it via a recursive
// tree walk. Lexical's own serialization is NEVER persisted (see serialize.ts);
// only this neutral tree crosses the web-component boundary and the network.
//
// This TypeScript definition is the REFERENCE; keep the C# CvApi.Domain and
// Python app/schemas.py in sync. Spec §9.2 / §9.3.

/** Closed set of node types — no other `type` is valid, and there is no raw HTML. */
export type NodeType =
  | 'root'
  | 'section'
  | 'paragraph'
  | 'text'
  | 'list'
  | 'listItem'
  | 'chips'
  | 'chip'
  | 'timeline'
  | 'entry';

/**
 * A node in the profile body tree. Every node is `{ type, id, attrs?, children? }`.
 * `attrs` holds type-specific leaf data (e.g. `text.attrs.text`,
 * `section.attrs.heading`, `entry.attrs.dates`). `children` is ordered and the
 * array order IS document order.
 */
export interface BlockNode {
  type: NodeType;
  /** Stable, client-generated id — the reorder / diff / AI-patch key. */
  id: string;
  attrs?: Record<string, string>;
  children?: BlockNode[];
}

// Narrowed convenience aliases for each node type (spec §9.2). These describe the
// well-formed shapes the validator (validateDocument) enforces.
export type RootNode = BlockNode & { type: 'root'; children: SectionNode[] };
export type SectionNode = BlockNode & {
  type: 'section';
  attrs: { heading: string };
  children: FlowNode[];
};
export type FlowNode = ParagraphNode | ListNode | ChipsNode | TimelineNode;
export type ParagraphNode = BlockNode & { type: 'paragraph'; children: TextNode[] };
/** Leaf; plain string (marks are out of scope, spec §9.6). */
export type TextNode = BlockNode & { type: 'text'; attrs: { text: string } };
export type ListNode = BlockNode & { type: 'list'; children: ListItemNode[] };
export type ListItemNode = BlockNode & {
  type: 'listItem';
  children: (ParagraphNode | ListNode | ChipsNode)[];
};
export type ChipsNode = BlockNode & { type: 'chips'; children: ChipNode[] };
/** Leaf; short plain string. */
export type ChipNode = BlockNode & { type: 'chip'; attrs: { text: string } };
export type TimelineNode = BlockNode & { type: 'timeline'; children: EntryNode[] };
export type EntryNode = BlockNode & {
  type: 'entry';
  attrs: { title: string; dates: string };
  children: (ParagraphNode | ListNode)[];
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
// Schema / nesting matrix (spec §9.3)
// ---------------------------------------------------------------------------

/**
 * Allowed child types for each node type. Empty array = leaf (no children).
 * This is the single source of truth for the nesting matrix; the editor cannot
 * author violations, cv-api rejects them on write, and the PDF walk may assume
 * them.
 */
export const ALLOWED_CHILDREN: Record<NodeType, NodeType[]> = {
  root: ['section'],
  section: ['paragraph', 'list', 'chips', 'timeline'],
  paragraph: ['text'],
  text: [],
  list: ['listItem'],
  listItem: ['paragraph', 'list', 'chips'],
  chips: ['chip'],
  chip: [],
  timeline: ['entry'],
  entry: ['paragraph', 'list'],
};

/** Required `attrs` keys per node type (each value must be a string). */
const REQUIRED_ATTRS: Partial<Record<NodeType, string[]>> = {
  section: ['heading'],
  text: ['text'],
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
 * Validate a `BlockNode` tree against the §9.3 schema: closed type set, the
 * allowed-children matrix, required `attrs`, and a bounded flow depth. The
 * "flow depth" counts nesting of flow-level containers (section, listItem,
 * entry, list) so a deeply nested list/timeline chain is rejected once it
 * exceeds `maxDepth`. Leaf inline nodes (text, chip) and structural wrappers
 * (paragraph, chips) do not themselves add a flow level.
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

  // Node types that introduce a new flow nesting level. Only the genuinely
  // recursive containers count: a `list` can hold a nested `list` (via listItem)
  // and a `timeline` holds entries. `section` is the always-present base and
  // `list`/`listItem` are an inseparable pair, so counting those would
  // double-count and reject sensible trees (spec §9.3: "default 4 flow levels").
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

    // Required attrs.
    const required = REQUIRED_ATTRS[node.type];
    if (required) {
      for (const key of required) {
        if (typeof node.attrs?.[key] !== 'string') {
          errors.push(`node "${node.type}" (${node.id}) is missing required attr "${key}"`);
        }
      }
    }

    // Parent/child matrix.
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
      return; // stop descending; the violation is already recorded
    }

    for (const child of children) {
      visit(child, node.type, nextDepth);
    }
  };

  visit(doc.body, null, 0);

  return { valid: errors.length === 0, errors };
}

// Factory helpers for building well-formed BlockNode subtrees (spec §9.2 / §9.3).
// Each returns a fresh node with a new id. These keep node construction in one
// place so the editor, serialization layer, and tests agree on seeded shapes.

import {
  ALLOWED_CHILDREN,
  ChipNode,
  ChipsNode,
  EntryNode,
  ListItemNode,
  ListNode,
  NodeType,
  ParagraphNode,
  RootNode,
  SectionNode,
  TextNode,
  TimelineNode,
  newId,
} from './model';

export function textNode(text = ''): TextNode {
  return { type: 'text', id: newId(), attrs: { text } };
}

export function paragraphNode(text = ''): ParagraphNode {
  return { type: 'paragraph', id: newId(), children: [textNode(text)] };
}

export function chipNode(text = ''): ChipNode {
  return { type: 'chip', id: newId(), attrs: { text } };
}

export function chipsNode(texts: string[] = ['']): ChipsNode {
  return { type: 'chips', id: newId(), children: texts.map(chipNode) };
}

export function listItemNode(text = ''): ListItemNode {
  return { type: 'listItem', id: newId(), children: [paragraphNode(text)] };
}

export function listNode(texts: string[] = ['']): ListNode {
  return { type: 'list', id: newId(), children: texts.map(listItemNode) };
}

export function entryNode(title = '', dates = '', description = ''): EntryNode {
  return {
    type: 'entry',
    id: newId(),
    attrs: { title, dates },
    children: [paragraphNode(description)],
  };
}

export function timelineNode(entries: EntryNode[] = [entryNode()]): TimelineNode {
  return { type: 'timeline', id: newId(), children: entries };
}

export function sectionNode(heading = 'Section heading'): SectionNode {
  return {
    type: 'section',
    id: newId(),
    attrs: { heading },
    children: [paragraphNode()],
  };
}

export function rootNode(children: SectionNode[] = []): RootNode {
  return { type: 'root', id: newId(), children };
}

// The closed widget set offered by the insert menu (spec §9.4). `kind` is the
// flow-level widget; `make` produces a fresh subtree to insert at the caret.
export type WidgetKind = 'text' | 'chips' | 'list' | 'timeline';

export interface WidgetDescriptor {
  kind: WidgetKind;
  name: string;
  description: string;
  make: () => ParagraphNode | ChipsNode | ListNode | TimelineNode;
}

export const WIDGETS: WidgetDescriptor[] = [
  {
    kind: 'text',
    name: 'Text',
    description: 'A paragraph of free-form text.',
    make: () => paragraphNode(),
  },
  {
    kind: 'chips',
    name: 'Chips',
    description: 'Short tag-style items — skills, tools, languages.',
    make: () => chipsNode(),
  },
  {
    kind: 'list',
    name: 'List',
    description: 'A bulleted list; each item is rich content.',
    make: () => listNode(),
  },
  {
    kind: 'timeline',
    name: 'Timeline',
    description: 'Dated entries — work experience, education, projects.',
    make: () => timelineNode(),
  },
];

/**
 * Widgets permitted as a direct child of `parent`, filtered by the §9.3 matrix.
 * Used to scope the insert menu to what is valid at the caret. `timeline` maps
 * to its node type for the matrix lookup; the others map 1:1.
 */
export function widgetsAllowedIn(parent: NodeType): WidgetDescriptor[] {
  const allowed = new Set(ALLOWED_CHILDREN[parent]);
  return WIDGETS.filter((w) =>
    allowed.has(w.kind === 'text' ? 'paragraph' : (w.kind as NodeType)),
  );
}

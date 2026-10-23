// Factory helpers for building well-formed BlockNode subtrees (spec §9.2 / §9.3 / §13).
// Each returns a fresh node with a new id. These keep node construction in one
// place so the editor, serialization layer, and tests agree on seeded shapes.

import {
  ALLOWED_CHILDREN,
  ChipNode,
  ChipsNode,
  EntryNode,
  FlowNode,
  InlineLinkNode,
  ListItemNode,
  ListNode,
  NodeType,
  ParagraphNode,
  RootNode,
  TextNode,
  TimelineNode,
  TitleNode,
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

/** An inline hyperlink run inside paragraph text (spec §15). */
export function inlineLinkNode(text = '', url = ''): InlineLinkNode {
  return { type: 'inlineLink', id: newId(), attrs: { text, url } };
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

export function titleNode(text = ''): TitleNode {
  return { type: 'title', id: newId(), attrs: { text } };
}

export function rootNode(children: (TitleNode | FlowNode)[] = []): RootNode {
  return { type: 'root', id: newId(), children };
}

// The closed widget set offered by the insert rail (spec §9.4 / §13.2.5). `kind` is the
// flow-level widget; `make` produces a fresh subtree to insert at the caret. Link is
// not a widget: links are inline runs, so the rail's Link button is a text action
// (wrap the selection / insert at the caret) handled by the link editor.
export type WidgetKind = 'title' | 'text' | 'chips' | 'list' | 'timeline';

export interface WidgetDescriptor {
  kind: WidgetKind;
  name: string;
  description: string;
  make: () => TitleNode | ParagraphNode | ChipsNode | ListNode | TimelineNode;
}

export const WIDGETS: WidgetDescriptor[] = [
  {
    kind: 'title',
    name: 'Title',
    description: 'A bold heading. Drag it to move all content below it as a group.',
    make: () => titleNode(),
  },
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
 * Widgets permitted as a direct child of `parent`, filtered by the §9.3 / §13 matrix.
 * Used to scope the insert menu to what is valid at the caret.
 */
export function widgetsAllowedIn(parent: NodeType): WidgetDescriptor[] {
  const allowed = new Set(ALLOWED_CHILDREN[parent]);
  return WIDGETS.filter((w) => {
    const nodeType: NodeType = w.kind === 'text' ? 'paragraph' : w.kind;
    return allowed.has(nodeType);
  });
}

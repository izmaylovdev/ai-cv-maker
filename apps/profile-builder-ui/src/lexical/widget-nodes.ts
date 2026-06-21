// Custom Lexical nodes for our closed widget set (spec §9.4). Each maps 1:1 to a
// BlockNode type and carries the neutral tree's stable `id` (and leaf `attrs`) so
// the serialization layer (serialize.ts) can round-trip without relying on
// Lexical's internal JSON. These are ElementNode/Decorator-free structural nodes:
// section / chips / chip / timeline / entry. (paragraph/text/list/listItem reuse
// Lexical + @lexical/list built-ins.)

import {
  EditorConfig,
  ElementNode,
  LexicalNode,
  ParagraphNode as LexicalParagraphNode,
  SerializedElementNode,
  SerializedParagraphNode,
  SerializedTextNode,
  Spread,
  TextNode as LexicalTextNode,
} from 'lexical';
import {
  ListItemNode as LexicalListItemNode,
  ListNode as LexicalListNode,
  SerializedListItemNode,
  SerializedListNode,
} from '@lexical/list';

let counter = 0;
/** Fallback id for nodes created in the editor before serialization assigns one. */
export function ephemeralId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

// ---- SectionNode ----------------------------------------------------------

export type SerializedSectionNode = Spread<
  { nodeId: string; heading: string },
  SerializedElementNode
>;

export class SectionNode extends ElementNode {
  __nodeId: string;
  __heading: string;

  static getType(): string {
    return 'pb-section';
  }

  static clone(node: SectionNode): SectionNode {
    return new SectionNode(node.__nodeId, node.__heading, node.__key);
  }

  constructor(nodeId?: string, heading = '', key?: string) {
    super(key);
    this.__nodeId = nodeId ?? ephemeralId('section');
    this.__heading = heading;
  }

  getNodeId(): string {
    return this.getLatest().__nodeId;
  }

  getHeading(): string {
    return this.getLatest().__heading;
  }

  setHeading(heading: string): void {
    this.getWritable().__heading = heading;
  }

  createDOM(config: EditorConfig): HTMLElement {
    const el = document.createElement('section');
    if (config.theme['pbSection']) el.className = config.theme['pbSection'] as string;
    el.setAttribute('data-pb', 'section');
    return el;
  }

  updateDOM(): boolean {
    return false;
  }

  exportJSON(): SerializedSectionNode {
    return {
      ...super.exportJSON(),
      type: SectionNode.getType(),
      version: 1,
      nodeId: this.__nodeId,
      heading: this.__heading,
    };
  }

  static importJSON(json: SerializedSectionNode): SectionNode {
    return new SectionNode(json.nodeId, json.heading);
  }

  // A section is a block-level container, never inline.
  isInline(): false {
    return false;
  }

  canBeEmpty(): false {
    return false;
  }
}

export function $createSectionNode(nodeId?: string, heading = ''): SectionNode {
  return new SectionNode(nodeId, heading);
}
export function $isSectionNode(node: LexicalNode | null | undefined): node is SectionNode {
  return node instanceof SectionNode;
}

// ---- ChipsNode / ChipNode -------------------------------------------------

export type SerializedChipsNode = Spread<{ nodeId: string }, SerializedElementNode>;

export class ChipsNode extends ElementNode {
  __nodeId: string;
  static getType(): string {
    return 'pb-chips';
  }
  static clone(node: ChipsNode): ChipsNode {
    return new ChipsNode(node.__nodeId, node.__key);
  }
  constructor(nodeId?: string, key?: string) {
    super(key);
    this.__nodeId = nodeId ?? ephemeralId('chips');
  }
  getNodeId(): string {
    return this.getLatest().__nodeId;
  }
  createDOM(config: EditorConfig): HTMLElement {
    const el = document.createElement('div');
    if (config.theme['pbChips']) el.className = config.theme['pbChips'] as string;
    el.setAttribute('data-pb', 'chips');
    return el;
  }
  updateDOM(): boolean {
    return false;
  }
  exportJSON(): SerializedChipsNode {
    return { ...super.exportJSON(), type: ChipsNode.getType(), version: 1, nodeId: this.__nodeId };
  }
  static importJSON(json: SerializedChipsNode): ChipsNode {
    return new ChipsNode(json.nodeId);
  }
  isInline(): false {
    return false;
  }
}

export function $createChipsNode(nodeId?: string): ChipsNode {
  return new ChipsNode(nodeId);
}
export function $isChipsNode(node: LexicalNode | null | undefined): node is ChipsNode {
  return node instanceof ChipsNode;
}

export type SerializedChipNode = Spread<
  { nodeId: string; text: string },
  SerializedElementNode
>;

/** A chip is a leaf-ish element carrying a plain-string label. */
export class ChipNode extends ElementNode {
  __nodeId: string;
  __text: string;
  static getType(): string {
    return 'pb-chip';
  }
  static clone(node: ChipNode): ChipNode {
    return new ChipNode(node.__nodeId, node.__text, node.__key);
  }
  constructor(nodeId?: string, text = '', key?: string) {
    super(key);
    this.__nodeId = nodeId ?? ephemeralId('chip');
    this.__text = text;
  }
  getNodeId(): string {
    return this.getLatest().__nodeId;
  }
  getChipText(): string {
    return this.getLatest().__text;
  }
  setChipText(text: string): void {
    this.getWritable().__text = text;
  }
  createDOM(config: EditorConfig): HTMLElement {
    const el = document.createElement('span');
    if (config.theme['pbChip']) el.className = config.theme['pbChip'] as string;
    el.setAttribute('data-pb', 'chip');
    return el;
  }
  updateDOM(): boolean {
    return false;
  }
  exportJSON(): SerializedChipNode {
    return {
      ...super.exportJSON(),
      type: ChipNode.getType(),
      version: 1,
      nodeId: this.__nodeId,
      text: this.__text,
    };
  }
  static importJSON(json: SerializedChipNode): ChipNode {
    return new ChipNode(json.nodeId, json.text);
  }
  isInline(): true {
    return true;
  }
}

export function $createChipNode(nodeId?: string, text = ''): ChipNode {
  return new ChipNode(nodeId, text);
}
export function $isChipNode(node: LexicalNode | null | undefined): node is ChipNode {
  return node instanceof ChipNode;
}

// ---- TimelineNode / EntryNode ---------------------------------------------

export type SerializedTimelineNode = Spread<{ nodeId: string }, SerializedElementNode>;

export class TimelineNode extends ElementNode {
  __nodeId: string;
  static getType(): string {
    return 'pb-timeline';
  }
  static clone(node: TimelineNode): TimelineNode {
    return new TimelineNode(node.__nodeId, node.__key);
  }
  constructor(nodeId?: string, key?: string) {
    super(key);
    this.__nodeId = nodeId ?? ephemeralId('timeline');
  }
  getNodeId(): string {
    return this.getLatest().__nodeId;
  }
  createDOM(config: EditorConfig): HTMLElement {
    const el = document.createElement('div');
    if (config.theme['pbTimeline']) el.className = config.theme['pbTimeline'] as string;
    el.setAttribute('data-pb', 'timeline');
    return el;
  }
  updateDOM(): boolean {
    return false;
  }
  exportJSON(): SerializedTimelineNode {
    return {
      ...super.exportJSON(),
      type: TimelineNode.getType(),
      version: 1,
      nodeId: this.__nodeId,
    };
  }
  static importJSON(json: SerializedTimelineNode): TimelineNode {
    return new TimelineNode(json.nodeId);
  }
  isInline(): false {
    return false;
  }
}

export function $createTimelineNode(nodeId?: string): TimelineNode {
  return new TimelineNode(nodeId);
}
export function $isTimelineNode(node: LexicalNode | null | undefined): node is TimelineNode {
  return node instanceof TimelineNode;
}

export type SerializedEntryNode = Spread<
  { nodeId: string; title: string; dates: string },
  SerializedElementNode
>;

export class EntryNode extends ElementNode {
  __nodeId: string;
  __title: string;
  __dates: string;
  static getType(): string {
    return 'pb-entry';
  }
  static clone(node: EntryNode): EntryNode {
    return new EntryNode(node.__nodeId, node.__title, node.__dates, node.__key);
  }
  constructor(nodeId?: string, title = '', dates = '', key?: string) {
    super(key);
    this.__nodeId = nodeId ?? ephemeralId('entry');
    this.__title = title;
    this.__dates = dates;
  }
  getNodeId(): string {
    return this.getLatest().__nodeId;
  }
  getTitle(): string {
    return this.getLatest().__title;
  }
  getDates(): string {
    return this.getLatest().__dates;
  }
  setTitle(title: string): void {
    this.getWritable().__title = title;
  }
  setDates(dates: string): void {
    this.getWritable().__dates = dates;
  }
  createDOM(config: EditorConfig): HTMLElement {
    const el = document.createElement('div');
    if (config.theme['pbEntry']) el.className = config.theme['pbEntry'] as string;
    el.setAttribute('data-pb', 'entry');
    return el;
  }
  updateDOM(): boolean {
    return false;
  }
  exportJSON(): SerializedEntryNode {
    return {
      ...super.exportJSON(),
      type: EntryNode.getType(),
      version: 1,
      nodeId: this.__nodeId,
      title: this.__title,
      dates: this.__dates,
    };
  }
  static importJSON(json: SerializedEntryNode): EntryNode {
    return new EntryNode(json.nodeId, json.title, json.dates);
  }
  isInline(): false {
    return false;
  }
  canBeEmpty(): false {
    return false;
  }
}

export function $createEntryNode(nodeId?: string, title = '', dates = ''): EntryNode {
  return new EntryNode(nodeId, title, dates);
}
export function $isEntryNode(node: LexicalNode | null | undefined): node is EntryNode {
  return node instanceof EntryNode;
}

// ---- Id-carrying built-in subclasses --------------------------------------
// paragraph / text / list / listItem reuse Lexical (+ @lexical/list) behaviour
// but must carry the neutral tree's stable `id` so serialization round-trips it
// (model.ts requires every node to keep its id). Each subclass overrides the
// type, clone, and JSON to thread `__nodeId` through.

export type SerializedPbParagraphNode = Spread<{ nodeId: string }, SerializedParagraphNode>;

export class PbParagraphNode extends LexicalParagraphNode {
  __nodeId: string;
  static getType(): string {
    return 'pb-paragraph';
  }
  static clone(node: PbParagraphNode): PbParagraphNode {
    return new PbParagraphNode(node.__nodeId, node.__key);
  }
  constructor(nodeId?: string, key?: string) {
    super(key);
    this.__nodeId = nodeId ?? ephemeralId('paragraph');
  }
  getNodeId(): string {
    return this.getLatest().__nodeId;
  }
  exportJSON(): SerializedPbParagraphNode {
    return { ...super.exportJSON(), type: PbParagraphNode.getType(), version: 1, nodeId: this.__nodeId };
  }
  static importJSON(json: SerializedPbParagraphNode): PbParagraphNode {
    return new PbParagraphNode(json.nodeId);
  }
}

export function $createPbParagraphNode(nodeId?: string): PbParagraphNode {
  return new PbParagraphNode(nodeId);
}
export function $isPbParagraphNode(node: LexicalNode | null | undefined): node is PbParagraphNode {
  return node instanceof PbParagraphNode;
}

export type SerializedPbTextNode = Spread<{ nodeId: string }, SerializedTextNode>;

export class PbTextNode extends LexicalTextNode {
  __nodeId: string;
  static getType(): string {
    return 'pb-text';
  }
  static clone(node: PbTextNode): PbTextNode {
    return new PbTextNode(node.__nodeId, node.__text, node.__key);
  }
  constructor(nodeId: string | undefined, text: string, key?: string) {
    super(text, key);
    this.__nodeId = nodeId ?? ephemeralId('text');
  }
  getNodeId(): string {
    return this.getLatest().__nodeId;
  }
  exportJSON(): SerializedPbTextNode {
    return { ...super.exportJSON(), type: PbTextNode.getType(), version: 1, nodeId: this.__nodeId };
  }
  static importJSON(json: SerializedPbTextNode): PbTextNode {
    return new PbTextNode(json.nodeId, json.text);
  }
}

export function $createPbTextNode(nodeId: string | undefined, text: string): PbTextNode {
  return new PbTextNode(nodeId, text);
}
export function $isPbTextNode(node: LexicalNode | null | undefined): node is PbTextNode {
  return node instanceof PbTextNode;
}

export type SerializedPbListNode = Spread<{ nodeId: string }, SerializedListNode>;

export class PbListNode extends LexicalListNode {
  __nodeId: string;
  static getType(): string {
    return 'pb-list';
  }
  static clone(node: PbListNode): PbListNode {
    return new PbListNode(node.__nodeId, node.__key);
  }
  constructor(nodeId?: string, key?: string) {
    super('bullet', 1, key);
    this.__nodeId = nodeId ?? ephemeralId('list');
  }
  getNodeId(): string {
    return this.getLatest().__nodeId;
  }
  exportJSON(): SerializedPbListNode {
    return { ...super.exportJSON(), type: PbListNode.getType(), version: 1, nodeId: this.__nodeId };
  }
  static importJSON(json: SerializedPbListNode): PbListNode {
    return new PbListNode(json.nodeId);
  }
}

export function $createPbListNode(nodeId?: string): PbListNode {
  return new PbListNode(nodeId);
}
export function $isPbListNode(node: LexicalNode | null | undefined): node is PbListNode {
  return node instanceof PbListNode;
}

export type SerializedPbListItemNode = Spread<
  { nodeId: string; paraId: string; paraTextId: string },
  SerializedListItemNode
>;

/**
 * Id-carrying list item. Lexical holds a bullet's inline text *directly* in the
 * list item (no paragraph wrapper), but our neutral model wraps it in a
 * `paragraph` → `text` (matrix: `listItem → paragraph|list|chips`). To round-trip
 * losslessly we keep the leading paragraph's id (`__paraId`) and its text node's
 * id (`__paraTextId`) on the list item; the serializer flattens on write and
 * re-wraps on read.
 */
export class PbListItemNode extends LexicalListItemNode {
  __nodeId: string;
  __paraId: string;
  __paraTextId: string;
  static getType(): string {
    return 'pb-listitem';
  }
  static clone(node: PbListItemNode): PbListItemNode {
    return new PbListItemNode(node.__nodeId, node.__paraId, node.__paraTextId, node.__key);
  }
  constructor(nodeId?: string, paraId?: string, paraTextId?: string, key?: string) {
    super(undefined, undefined, key);
    this.__nodeId = nodeId ?? ephemeralId('listItem');
    this.__paraId = paraId ?? ephemeralId('paragraph');
    this.__paraTextId = paraTextId ?? ephemeralId('text');
  }
  getNodeId(): string {
    return this.getLatest().__nodeId;
  }
  getParaId(): string {
    return this.getLatest().__paraId;
  }
  getParaTextId(): string {
    return this.getLatest().__paraTextId;
  }
  setParaIds(paraId: string, paraTextId: string): void {
    const w = this.getWritable();
    w.__paraId = paraId;
    w.__paraTextId = paraTextId;
  }
  exportJSON(): SerializedPbListItemNode {
    return {
      ...super.exportJSON(),
      type: PbListItemNode.getType(),
      version: 1,
      nodeId: this.__nodeId,
      paraId: this.__paraId,
      paraTextId: this.__paraTextId,
    };
  }
  static importJSON(json: SerializedPbListItemNode): PbListItemNode {
    return new PbListItemNode(json.nodeId, json.paraId, json.paraTextId);
  }
}

export function $createPbListItemNode(
  nodeId?: string,
  paraId?: string,
  paraTextId?: string,
): PbListItemNode {
  return new PbListItemNode(nodeId, paraId, paraTextId);
}
export function $isPbListItemNode(node: LexicalNode | null | undefined): node is PbListItemNode {
  return node instanceof PbListItemNode;
}

/**
 * All custom nodes for the editor's `nodes` config. Includes the structural
 * widgets and the id-carrying built-in subclasses (which replace Lexical's
 * paragraph/text and @lexical/list's list/listItem so every node keeps its id).
 */
export const WIDGET_NODES = [
  SectionNode,
  ChipsNode,
  ChipNode,
  TimelineNode,
  EntryNode,
  PbParagraphNode,
  PbTextNode,
  PbListNode,
  PbListItemNode,
  // Override the built-ins so editor commands that create paragraphs/lists use
  // our id-carrying variants.
  { replace: LexicalParagraphNode, with: () => new PbParagraphNode() },
  { replace: LexicalTextNode, with: (n: LexicalTextNode) => new PbTextNode(undefined, n.__text) },
  { replace: LexicalListNode, with: () => new PbListNode() },
  { replace: LexicalListItemNode, with: () => new PbListItemNode() },
];

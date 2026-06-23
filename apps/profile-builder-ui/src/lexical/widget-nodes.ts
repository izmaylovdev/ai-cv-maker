// Custom Lexical nodes for our closed widget set (spec §9.4 / ADR-0014). Each
// maps to a BlockNode type and carries the neutral tree's stable `id` so the
// serialization layer (serialize.ts) can round-trip without relying on Lexical's
// internal JSON.
//
// Editing model: the structured widgets are made editable as NATIVE Lexical
// content rather than opaque containers —
//   • section heading, timeline entry title/dates → dedicated element nodes that
//     hold a real (editable) text child; the serializer lifts their text into
//     the neutral node's `attrs` (heading/title/dates) and back.
//   • chips → a DecoratorNode rendering a React tag UI (chip text lives in node
//     state; the serializer maps it to/from `chip` children).
//   • paragraph / text / list / listItem reuse Lexical (+ @lexical/list)
//     built-ins, subclassed only to thread the stable id.

import { LinkNode } from '@lexical/link';
import {
  DecoratorNode,
  EditorConfig,
  ElementNode,
  LexicalEditor,
  LexicalNode,
  ParagraphNode as LexicalParagraphNode,
  SerializedElementNode,
  SerializedLexicalNode,
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
import type { ReactNode } from 'react';
import { createElement } from 'react';
import { ChipsComponent } from './ChipsComponent';
import { LinkComponent } from './LinkComponent';

let counter = 0;
/** Fallback id for nodes created in the editor before serialization assigns one. */
export function ephemeralId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

/** Shared base for our id-carrying structural element nodes. */
abstract class IdElementNode extends ElementNode {
  __nodeId: string;
  constructor(nodeId: string | undefined, prefix: string, key?: string) {
    super(key);
    this.__nodeId = nodeId ?? ephemeralId(prefix);
  }
  getNodeId(): string {
    return this.getLatest().__nodeId;
  }
  updateDOM(): boolean {
    return false;
  }
}

// ---- SectionNode + SectionHeadingNode -------------------------------------

export type SerializedSectionNode = Spread<{ nodeId: string }, SerializedElementNode>;

/** A document section: a heading line followed by flow content. */
export class SectionNode extends IdElementNode {
  static getType(): string {
    return 'pb-section';
  }
  static clone(node: SectionNode): SectionNode {
    return new SectionNode(node.__nodeId, node.__key);
  }
  constructor(nodeId?: string, key?: string) {
    super(nodeId, 'section', key);
  }
  createDOM(config: EditorConfig): HTMLElement {
    const el = document.createElement('section');
    el.className = (config.theme as Record<string, string>)['pbSection'] ?? 'pb-section';
    el.setAttribute('data-pb', 'section');
    return el;
  }
  exportJSON(): SerializedSectionNode {
    return { ...super.exportJSON(), type: SectionNode.getType(), version: 1, nodeId: this.__nodeId };
  }
  static importJSON(json: SerializedSectionNode): SectionNode {
    return new SectionNode(json.nodeId);
  }
  isInline(): false {
    return false;
  }
  canBeEmpty(): false {
    return false;
  }
}
export function $createSectionNode(nodeId?: string): SectionNode {
  return new SectionNode(nodeId);
}
export function $isSectionNode(node: LexicalNode | null | undefined): node is SectionNode {
  return node instanceof SectionNode;
}

export type SerializedSectionHeadingNode = Spread<{ nodeId: string }, SerializedElementNode>;

/** The editable heading line at the top of a section (holds a text child). */
export class SectionHeadingNode extends IdElementNode {
  static getType(): string {
    return 'pb-section-heading';
  }
  static clone(node: SectionHeadingNode): SectionHeadingNode {
    return new SectionHeadingNode(node.__nodeId, node.__key);
  }
  constructor(nodeId?: string, key?: string) {
    super(nodeId, 'heading', key);
  }
  createDOM(config: EditorConfig): HTMLElement {
    const el = document.createElement('div');
    el.className = (config.theme as Record<string, string>)['pbSectionHeading'] ?? 'pb-section__heading';
    el.setAttribute('data-pb', 'section-heading');
    el.setAttribute('data-placeholder', 'Section heading');
    return el;
  }
  exportJSON(): SerializedSectionHeadingNode {
    return { ...super.exportJSON(), type: SectionHeadingNode.getType(), version: 1, nodeId: this.__nodeId };
  }
  static importJSON(json: SerializedSectionHeadingNode): SectionHeadingNode {
    return new SectionHeadingNode(json.nodeId);
  }
  isInline(): false {
    return false;
  }
  // The heading is a required part of its section — Backspace at start must not
  // merge it into the previous section's content.
  collapseAtStart(): boolean {
    return false;
  }
}
export function $createSectionHeadingNode(nodeId?: string): SectionHeadingNode {
  return new SectionHeadingNode(nodeId);
}
export function $isSectionHeadingNode(node: LexicalNode | null | undefined): node is SectionHeadingNode {
  return node instanceof SectionHeadingNode;
}

// ---- PbTitleNode -----------------------------------------------------------

export type SerializedTitleNode = Spread<{ nodeId: string }, SerializedElementNode>;

/**
 * A section-heading block (spec §13.2.3). Holds a single editable PbTextNode
 * child. At the root level, it anchors a "title group" — all non-title siblings
 * that follow it until the next PbTitleNode (or end of root) belong to its group
 * and move with it when reordered.
 */
export class PbTitleNode extends IdElementNode {
  static getType(): string {
    return 'pb-title';
  }
  static clone(node: PbTitleNode): PbTitleNode {
    return new PbTitleNode(node.__nodeId, node.__key);
  }
  constructor(nodeId?: string, key?: string) {
    super(nodeId, 'title', key);
  }
  createDOM(): HTMLElement {
    const el = document.createElement('h2');
    el.className = 'pb-title';
    el.setAttribute('data-pb', 'title');
    el.setAttribute('data-placeholder', 'Section heading');
    return el;
  }
  exportJSON(): SerializedTitleNode {
    return { ...super.exportJSON(), type: PbTitleNode.getType(), version: 1, nodeId: this.__nodeId };
  }
  static importJSON(json: SerializedTitleNode): PbTitleNode {
    return new PbTitleNode(json.nodeId);
  }
  isInline(): false {
    return false;
  }
  collapseAtStart(): boolean {
    return false;
  }
}
export function $createTitleNode(nodeId?: string): PbTitleNode {
  return new PbTitleNode(nodeId);
}
export function $isTitleNode(node: LexicalNode | null | undefined): node is PbTitleNode {
  return node instanceof PbTitleNode;
}

// ---- TimelineNode / EntryNode / title / dates -----------------------------

export type SerializedTimelineNode = Spread<{ nodeId: string }, SerializedElementNode>;

export class TimelineNode extends IdElementNode {
  static getType(): string {
    return 'pb-timeline';
  }
  static clone(node: TimelineNode): TimelineNode {
    return new TimelineNode(node.__nodeId, node.__key);
  }
  constructor(nodeId?: string, key?: string) {
    super(nodeId, 'timeline', key);
  }
  createDOM(config: EditorConfig): HTMLElement {
    const el = document.createElement('div');
    el.className = (config.theme as Record<string, string>)['pbTimeline'] ?? 'pb-workexp';
    el.setAttribute('data-pb', 'timeline');
    return el;
  }
  exportJSON(): SerializedTimelineNode {
    return { ...super.exportJSON(), type: TimelineNode.getType(), version: 1, nodeId: this.__nodeId };
  }
  static importJSON(json: SerializedTimelineNode): TimelineNode {
    return new TimelineNode(json.nodeId);
  }
  isInline(): false {
    return false;
  }
  canBeEmpty(): false {
    return false;
  }
}
export function $createTimelineNode(nodeId?: string): TimelineNode {
  return new TimelineNode(nodeId);
}
export function $isTimelineNode(node: LexicalNode | null | undefined): node is TimelineNode {
  return node instanceof TimelineNode;
}

export type SerializedEntryNode = Spread<{ nodeId: string }, SerializedElementNode>;

/** One dated entry: title + dates rows, then a rich description (flow). */
export class EntryNode extends IdElementNode {
  static getType(): string {
    return 'pb-entry';
  }
  static clone(node: EntryNode): EntryNode {
    return new EntryNode(node.__nodeId, node.__key);
  }
  constructor(nodeId?: string, key?: string) {
    super(nodeId, 'entry', key);
  }
  createDOM(config: EditorConfig): HTMLElement {
    const el = document.createElement('div');
    el.className = (config.theme as Record<string, string>)['pbEntry'] ?? 'pb-item';
    el.setAttribute('data-pb', 'entry');
    return el;
  }
  exportJSON(): SerializedEntryNode {
    return { ...super.exportJSON(), type: EntryNode.getType(), version: 1, nodeId: this.__nodeId };
  }
  static importJSON(json: SerializedEntryNode): EntryNode {
    return new EntryNode(json.nodeId);
  }
  isInline(): false {
    return false;
  }
  canBeEmpty(): false {
    return false;
  }
}
export function $createEntryNode(nodeId?: string): EntryNode {
  return new EntryNode(nodeId);
}
export function $isEntryNode(node: LexicalNode | null | undefined): node is EntryNode {
  return node instanceof EntryNode;
}

export type SerializedEntryFieldNode = Spread<{ nodeId: string; field: 'title' | 'dates' }, SerializedElementNode>;

/** The editable title / dates line of an entry (holds a text child). */
export class EntryFieldNode extends IdElementNode {
  __field: 'title' | 'dates';
  static getType(): string {
    return 'pb-entry-field';
  }
  static clone(node: EntryFieldNode): EntryFieldNode {
    return new EntryFieldNode(node.__nodeId, node.__field, node.__key);
  }
  constructor(nodeId: string | undefined, field: 'title' | 'dates', key?: string) {
    super(nodeId, field, key);
    this.__field = field;
  }
  getField(): 'title' | 'dates' {
    return this.getLatest().__field;
  }
  createDOM(config: EditorConfig): HTMLElement {
    const el = document.createElement('div');
    const theme = config.theme as Record<string, string>;
    el.className = this.__field === 'title' ? theme['pbItemTitle'] ?? 'pb-item__title' : theme['pbItemDates'] ?? 'pb-item__dates';
    el.setAttribute('data-pb', `entry-${this.__field}`);
    el.setAttribute('data-placeholder', this.__field === 'title' ? 'Title — role, degree, or project' : 'Jan 2022 – Present');
    return el;
  }
  exportJSON(): SerializedEntryFieldNode {
    return {
      ...super.exportJSON(),
      type: EntryFieldNode.getType(),
      version: 1,
      nodeId: this.__nodeId,
      field: this.__field,
    };
  }
  static importJSON(json: SerializedEntryFieldNode): EntryFieldNode {
    return new EntryFieldNode(json.nodeId, json.field);
  }
  isInline(): false {
    return false;
  }
  // A title/dates line is a required part of its entry — Backspace at its start
  // must not merge it into (or delete it from) the entry. Returning false stops
  // Lexical's default collapse/merge so the field can be emptied but not removed.
  collapseAtStart(): boolean {
    return false;
  }
}
export function $createEntryFieldNode(field: 'title' | 'dates', nodeId?: string): EntryFieldNode {
  return new EntryFieldNode(nodeId, field);
}
export function $isEntryFieldNode(node: LexicalNode | null | undefined): node is EntryFieldNode {
  return node instanceof EntryFieldNode;
}

// ---- ChipsNode (decorator) ------------------------------------------------

export interface Chip {
  id: string;
  text: string;
}
export type SerializedChipsNode = Spread<{ nodeId: string; chips: Chip[] }, SerializedLexicalNode>;

/** A tag cloud. Chip data lives in node state; a React component edits it. */
export class ChipsNode extends DecoratorNode<ReactNode> {
  __nodeId: string;
  __chips: Chip[];
  static getType(): string {
    return 'pb-chips';
  }
  static clone(node: ChipsNode): ChipsNode {
    return new ChipsNode(node.__nodeId, node.__chips, node.__key);
  }
  constructor(nodeId?: string, chips: Chip[] = [], key?: string) {
    super(key);
    this.__nodeId = nodeId ?? ephemeralId('chips');
    this.__chips = chips;
  }
  getNodeId(): string {
    return this.getLatest().__nodeId;
  }
  getChips(): Chip[] {
    return this.getLatest().__chips;
  }
  setChips(chips: Chip[]): void {
    this.getWritable().__chips = chips;
  }
  createDOM(config: EditorConfig): HTMLElement {
    const el = document.createElement('div');
    el.className = (config.theme as Record<string, string>)['pbChips'] ?? 'pb-chips';
    el.setAttribute('data-pb', 'chips');
    return el;
  }
  updateDOM(): boolean {
    return false;
  }
  isInline(): false {
    return false;
  }
  decorate(editor: LexicalEditor): ReactNode {
    return createElement(ChipsComponent, { editor, nodeKey: this.getKey(), chips: this.getChips() });
  }
  exportJSON(): SerializedChipsNode {
    return {
      type: ChipsNode.getType(),
      version: 1,
      nodeId: this.__nodeId,
      chips: this.__chips,
    };
  }
  static importJSON(json: SerializedChipsNode): ChipsNode {
    return new ChipsNode(json.nodeId, json.chips);
  }
}
export function $createChipsNode(nodeId?: string, chips: Chip[] = []): ChipsNode {
  return new ChipsNode(nodeId, chips);
}
export function $isChipsNode(node: LexicalNode | null | undefined): node is ChipsNode {
  return node instanceof ChipsNode;
}

// ---- LinkWidgetNode (decorator) -------------------------------------------

export type SerializedLinkNode = Spread<{ nodeId: string; text: string; url: string }, SerializedLexicalNode>;

/**
 * A standalone link line (spec §10). A leaf widget — text + url live in node
 * state and a small React component edits them; the serializer maps them to/from
 * the neutral `link` node's `attrs`. NOT an inline mark (those stay out of scope
 * per §9.6); it renders as its own block, like chips/timeline.
 */
export class LinkWidgetNode extends DecoratorNode<ReactNode> {
  __nodeId: string;
  __text: string;
  __url: string;
  static getType(): string {
    return 'pb-link';
  }
  static clone(node: LinkWidgetNode): LinkWidgetNode {
    return new LinkWidgetNode(node.__nodeId, node.__text, node.__url, node.__key);
  }
  constructor(nodeId?: string, text = '', url = '', key?: string) {
    super(key);
    this.__nodeId = nodeId ?? ephemeralId('link');
    this.__text = text;
    this.__url = url;
  }
  getNodeId(): string {
    return this.getLatest().__nodeId;
  }
  getText(): string {
    return this.getLatest().__text;
  }
  getUrl(): string {
    return this.getLatest().__url;
  }
  setLink(text: string, url: string): void {
    const writable = this.getWritable();
    writable.__text = text;
    writable.__url = url;
  }
  createDOM(config: EditorConfig): HTMLElement {
    const el = document.createElement('div');
    el.className = (config.theme as Record<string, string>)['pbLink'] ?? 'pb-link';
    el.setAttribute('data-pb', 'link');
    return el;
  }
  updateDOM(): boolean {
    return false;
  }
  isInline(): false {
    return false;
  }
  decorate(editor: LexicalEditor): ReactNode {
    return createElement(LinkComponent, {
      editor,
      nodeKey: this.getKey(),
      text: this.getText(),
      url: this.getUrl(),
    });
  }
  exportJSON(): SerializedLinkNode {
    return {
      type: LinkWidgetNode.getType(),
      version: 1,
      nodeId: this.__nodeId,
      text: this.__text,
      url: this.__url,
    };
  }
  static importJSON(json: SerializedLinkNode): LinkWidgetNode {
    return new LinkWidgetNode(json.nodeId, json.text, json.url);
  }
}
export function $createLinkNode(nodeId?: string, text = '', url = ''): LinkWidgetNode {
  return new LinkWidgetNode(nodeId, text, url);
}
export function $isLinkNode(node: LexicalNode | null | undefined): node is LinkWidgetNode {
  return node instanceof LinkWidgetNode;
}

// ---- Id-carrying built-in subclasses --------------------------------------
// paragraph / text / list / listItem reuse Lexical (+ @lexical/list) behaviour
// but carry the neutral tree's stable id so serialization round-trips it.

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
 * Id-carrying list item. Lexical holds a bullet's inline text directly (no
 * paragraph wrapper); our neutral model wraps it in `paragraph → text`. We keep
 * the leading paragraph/text ids on the item so the serializer can flatten on
 * write and re-wrap on read.
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
export function $createPbListItemNode(nodeId?: string, paraId?: string, paraTextId?: string): PbListItemNode {
  return new PbListItemNode(nodeId, paraId, paraTextId);
}
export function $isPbListItemNode(node: LexicalNode | null | undefined): node is PbListItemNode {
  return node instanceof PbListItemNode;
}

/** All custom nodes for the editor's `nodes` config. */
export const WIDGET_NODES = [
  LinkNode,
  PbTitleNode,
  SectionNode,
  SectionHeadingNode,
  TimelineNode,
  EntryNode,
  EntryFieldNode,
  ChipsNode,
  LinkWidgetNode,
  PbParagraphNode,
  PbTextNode,
  PbListNode,
  PbListItemNode,
  // Override the built-ins so editor commands that create paragraphs/lists use
  // our id-carrying variants.
  { replace: LexicalParagraphNode, with: () => new PbParagraphNode(), withKlass: PbParagraphNode },
  { replace: LexicalTextNode, with: (n: LexicalTextNode) => new PbTextNode(undefined, n.__text), withKlass: PbTextNode },
  { replace: LexicalListNode, with: () => new PbListNode(), withKlass: PbListNode },
  { replace: LexicalListItemNode, with: () => new PbListItemNode(), withKlass: PbListItemNode },
];

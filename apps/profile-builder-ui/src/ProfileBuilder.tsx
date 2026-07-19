import { useEffect, useRef, useState, type ReactNode } from 'react';
import './ProfileBuilder.css';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { mergeRegister } from '@lexical/utils';
import { TOGGLE_LINK_COMMAND } from '@lexical/link';
import {
  $createParagraphNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isParagraphNode,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_NORMAL,
  ElementNode,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  KEY_DOWN_COMMAND,
  KEY_ENTER_COMMAND,
  LexicalNode,
  PASTE_COMMAND,
  PointType,
} from 'lexical';
import {
  ProfileDocument,
  ProfileHeader as ProfileHeaderModel,
  RootNode,
  emptyHeader,
} from './model';
import {
  WIDGET_NODES,
  $isTitleNode,
  $isEntryNode, $isEntryFieldNode, $isTimelineNode, $isPbListNode, $isPbTextNode, $isInlineLinkNode,
  $isSectionHeadingNode,
  $createEntryNode, $createEntryFieldNode, $createPbTextNode, $createPbParagraphNode, $createInlineLinkNode,
} from './lexical/widget-nodes';
import { $createLexicalNode, $readBody, loadDocument } from './serialize';
import { WIDGETS, WidgetDescriptor, widgetsAllowedIn } from './nodes';
import type { NodeType } from './model';
import { ProfileHeader } from './components/ProfileHeader';

// Document builder root (spec §13 / ADR-0014). The whole profile body is ONE
// Lexical editor over a flat neutral BlockNode sequence; title nodes anchor
// reorderable groups. Host-agnostic: no fetch/auth/routing.

export interface ProfileBuilderProps {
  document: ProfileDocument;
  onChange?: (document: ProfileDocument) => void;
}

const THEME = {
  paragraph: 'pb-paragraph',
  pbTitle: 'pb-title',
  pbChips: 'pb-chips',
  pbTimeline: 'pb-workexp',
  pbEntry: 'pb-item',
  pbItemTitle: 'pb-item__title',
  pbItemDates: 'pb-item__dates',
  list: { ul: 'pb-list', listitem: 'pb-list__item', nested: { listitem: 'pb-li--nested' } },
};

export function ProfileBuilder({ document, onChange }: ProfileBuilderProps) {
  const header = document.header ?? emptyHeader();
  // Sentinel ('') is intentionally not valid JSON — guarantees LoadBodyPlugin's
  // first effect always calls loadDocument regardless of what document.body holds.
  const bodyJsonRef = useRef<string>('');
  const rootIdRef = useRef<string>(document.body.id);
  rootIdRef.current = document.body.id;

  // Emit the latest editor body alongside the new header. Before LoadBodyPlugin's
  // first effect runs, the sentinel ref is still '' (not valid JSON) — fall back
  // to the incoming document.body so a header edit made early never crashes on
  // JSON.parse('') and silently drops the change.
  const emitHeader = (next: ProfileHeaderModel) =>
    onChange?.({
      header: next,
      body: bodyJsonRef.current ? parse(bodyJsonRef.current) : document.body,
    });

  const emitBody = (body: RootNode) => {
    const json = JSON.stringify(body);
    if (json === bodyJsonRef.current) return;
    bodyJsonRef.current = json;
    onChange?.({ header, body });
  };

  const initialConfig = {
    namespace: 'profile-builder',
    nodes: WIDGET_NODES,
    theme: THEME,
    onError: (error: Error) => console.error('[profile-builder]', error),
  };

  return (
    <div className="pb-root">
      <LexicalComposer initialConfig={initialConfig}>
        <div className="pb-shell">
          <ControlRail />
          <div className="pb-sheet">
            <ProfileHeader header={header} onChange={emitHeader} />
            <div className="pb-doc">
              <RichTextPlugin
                contentEditable={<ContentEditable className="pb-content" />}
                placeholder={null}
                ErrorBoundary={LexicalErrorBoundary}
              />
              <TitleControls />
              <AddEntryButtons />
              <RemoveEntryButtons />
            </div>
          </div>
        </div>
        <HistoryPlugin />
        <ListPlugin />
        <EntryStructureGuardPlugin />
        <SingleLinePastePlugin />
        <TrailingParagraphPlugin />
        <LinkPlugin />
        <InlineLinkEditorPlugin />
        <LoadBodyPlugin body={document.body} bodyJsonRef={bodyJsonRef} />
        <OnChangePlugin
          ignoreSelectionChange
          onChange={(state) =>
            emitBody(state.read(() => $readBody(rootIdRef.current)))
          }
        />
      </LexicalComposer>
    </div>
  );
}

function parse(json: string): RootNode {
  return JSON.parse(json) as RootNode;
}

function LoadBodyPlugin({
  body,
  bodyJsonRef,
}: {
  body: RootNode;
  bodyJsonRef: React.MutableRefObject<string>;
}) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    const json = JSON.stringify(body);
    if (json === bodyJsonRef.current && editor.getEditorState()._nodeMap.size > 1) {
      return;
    }
    bodyJsonRef.current = json;
    loadDocument(editor, body);
  }, [editor, body, bodyJsonRef]);
  return null;
}

/**
 * Single-line fields (entry title/dates, section heading, title) must stay
 * single-line on paste.
 *
 * Lexical's default rich-text paste turns clipboard HTML into block nodes and
 * hands them to RangeSelection.insertNodes. Its "at least one block" branch
 * merges only the FIRST block into the caret's block and then calls
 * insertRangeAfter() for the rest — which drops those blocks in as *siblings of
 * the field*. Inside an entry that lands a stray paragraph between the title and
 * dates rows, breaking the title → dates → description contract; the pasted text
 * renders after the field instead of in it.
 *
 * These fields hold one line of plain text (the serializer lifts them into
 * `attrs`), so flattening the clipboard to a single line is both the correct
 * shape and what the user expects.
 */
function SingleLinePastePlugin() {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    return editor.registerCommand(
      PASTE_COMMAND,
      (event: ClipboardEvent) => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return false;

        let node: LexicalNode | null = selection.anchor.getNode();
        while (node && !$isEntryFieldNode(node) && !$isSectionHeadingNode(node) && !$isTitleNode(node)) {
          node = node.getParent();
        }
        if (!node) return false;

        const text = event.clipboardData?.getData('text/plain');
        if (!text) return false;

        event.preventDefault();
        // Collapse any newlines/tabs so a multi-line clipboard cannot split the field.
        selection.insertText(text.replace(/\s+/g, ' ').trim());
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor]);
  return null;
}

/**
 * Keeps a timeline entry's required subsections (title, dates, description)
 * intact. Also prevents Backspace from collapsing into / deleting a title node's
 * text when the caret is at the start.
 */
function EntryStructureGuardPlugin() {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    const atStructuralBoundary = (point: PointType, edge: 'start' | 'end'): boolean => {
      const node = point.getNode();
      if ($isTextNode(node)) {
        const edgeOffset = edge === 'start' ? 0 : node.getTextContentSize();
        if (point.offset !== edgeOffset) return false;
      } else {
        const edgeOffset = edge === 'start' ? 0 : node.getChildrenSize();
        if (point.offset !== edgeOffset) return false;
      }
      let current: LexicalNode | null = node;
      let parent = current.getParent();
      while (parent) {
        if ($isEntryNode(parent)) {
          if ($isPbListNode(current)) return false;
          const entrySib = current.getPreviousSibling();
          if (entrySib !== null && !$isEntryFieldNode(entrySib)) return false;
          return true;
        }
        // Title nodes are deleted like paragraphs — no structural guard.
        const sibling = edge === 'start' ? current.getPreviousSibling() : current.getNextSibling();
        if (sibling) return false;
        current = parent;
        parent = current.getParent();
      }
      return false;
    };

    const block = (edge: 'start' | 'end') => (event: KeyboardEvent | null) => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
      if (!atStructuralBoundary(selection.anchor, edge)) return false;
      event?.preventDefault();
      return true;
    };

    const handleTitleEnter = (event: KeyboardEvent | null) => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return false;
      let node: LexicalNode | null = selection.anchor.getNode();
      while (node && !$isTitleNode(node)) node = node.getParent();
      if (!$isTitleNode(node)) return false;
      event?.preventDefault();
      const para = $createParagraphNode();
      node.insertAfter(para);
      para.select();
      return true;
    };

    return mergeRegister(
      editor.registerCommand(KEY_BACKSPACE_COMMAND, block('start'), COMMAND_PRIORITY_HIGH),
      editor.registerCommand(KEY_DELETE_COMMAND, block('end'), COMMAND_PRIORITY_HIGH),
      editor.registerCommand(KEY_ENTER_COMMAND, handleTitleEnter, COMMAND_PRIORITY_HIGH),
    );
  }, [editor]);
  return null;
}

// Seed URL/label for a link before the user supplies a real URL. The floating
// editor treats it as "empty" (shows a blank input), and a caret-inserted link
// whose label still equals this placeholder gets removed if the user cancels.
const LINK_URL_PLACEHOLDER = 'https://';

/**
 * Floating Text/URL bar for inline links (spec §15, extended by §16). Appears
 * below the link while the caret is inside one; ✓/Enter commits both fields,
 * Escape closes without saving, ✕ removes the link. All commits target the link
 * by its node key captured when the bar opened — NOT the live selection —
 * because focusing an input blurs the editor (clearing the selection), and an
 * earlier version then dropped the typed URL on the floor (F-EDIT-21.4).
 *
 * The visible label is always `text || url` (F-EDIT-22.3/22.4). That single rule
 * replaces the old "rewrite the label only when it still mirrors the URL" check:
 * because the committed label is re-derived from the Text field every time, a
 * later URL-only edit re-commits the user's label unchanged instead of
 * clobbering it (F-EDIT-22.5), and an empty Text can never leave the link
 * rendered invisible.
 */
function InlineLinkEditorPlugin() {
  const [editor] = useLexicalComposerContext();
  const activeNodeKey = useRef<string | null>(null);
  const originalUrl = useRef<string>('');
  const originalText = useRef<string>('');
  const [open, setOpen] = useState(false);
  const [textVal, setTextVal] = useState('');
  const [urlVal, setUrlVal] = useState('');
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const sel = $getSelection();
        // No range selection means the editor blurred — typically because focus
        // moved to our URL input. Keep the bar (and its target link) intact so a
        // pending commit still lands; do NOT clear activeNodeKey here.
        if (!$isRangeSelection(sel)) return;
        const node = sel.anchor.getNode();
        const parent = node.getParent();
        const linkNode = $isInlineLinkNode(parent) ? parent : $isInlineLinkNode(node) ? node : null;
        if (!linkNode) { activeNodeKey.current = null; setOpen(false); return; }
        const key = linkNode.getKey();
        // Only reset the input when entering a *different* link — don't clobber what the user is typing.
        if (key !== activeNodeKey.current) {
          const url = linkNode.getURL();
          const label = linkNode.getTextContent();
          originalUrl.current = url;
          originalText.current = label;
          setUrlVal(url === LINK_URL_PLACEHOLDER ? '' : url);
          // A label that mirrors its URL is a caret-inserted link the user has
          // not named yet — open Text empty so mirroring stays live (F-EDIT-22.2).
          setTextVal(label === url || label === LINK_URL_PLACEHOLDER ? '' : label);
          activeNodeKey.current = key;
        }
        setOpen(true);
        const dom = editor.getElementByKey(key);
        if (dom) {
          const r = dom.getBoundingClientRect();
          setPos({ x: r.left, y: r.bottom + 6 });
        }
      });
    });
  }, [editor]);

  useEffect(() => {
    if (!open) return;
    // A link with no URL yet was just inserted, and the URL is its only required
    // field — start there. An existing link is more often opened to retitle it,
    // so focus Text.
    (urlVal ? inputRef : urlInputRef).current?.focus();
  }, [open]);

  // Place the caret just after the link once a commit/restore finishes, so
  // typing continues in the running text. The caret MUST land outside the link:
  // the old fallback, `parent.selectEnd()`, descends into the block's last
  // descendant, which for a trailing link is the link's own text node — the
  // caret lands back inside the link, the update listener matches
  // $isInlineLinkNode again and re-opens the bar the same tick it closed
  // (F-EDIT-22.8/22.9). With no next sibling there is no position outside the
  // link yet, so create one.
  const caretAfter = (node: LexicalNode) => {
    const next = node.getNextSibling();
    if (next) { next.selectStart(); return; }
    const tail = $createPbTextNode(undefined, '');
    node.insertAfter(tail);
    tail.selectEnd();
  };

  // Remove the link by key. A link whose label still mirrors its URL (a freshly
  // caret-inserted placeholder) is deleted outright; otherwise it is unwrapped,
  // keeping its visible text in the running prose.
  const removeByKey = (key: string) => {
    setOpen(false);
    activeNodeKey.current = null;
    editor.update(() => {
      const node = $getNodeByKey(key);
      if (!$isInlineLinkNode(node)) return;
      const label = node.getFirstChild();
      const mirrored = $isPbTextNode(label) && label.getTextContent() === node.getURL();
      const prev = node.getPreviousSibling();
      const next = node.getNextSibling();
      if (mirrored) {
        node.remove();
        if (next) next.selectStart();
        else if (prev && $isTextNode(prev)) prev.selectEnd();
      } else {
        let last: LexicalNode | null = null;
        for (const child of node.getChildren()) { node.insertBefore(child); last = child; }
        node.remove();
        last?.selectEnd();
      }
    });
  };

  // Write `label` as the link's single plain-text run. Defensively creates the
  // text child when the link has none, so a label can never go missing.
  const setLabel = (node: LexicalNode, label: string) => {
    if (!$isInlineLinkNode(node)) return;
    const first = node.getFirstChild();
    if ($isPbTextNode(first)) first.setTextContent(label);
    else node.append($createPbTextNode(undefined, label));
  };

  const commit = (text: string, url: string) => {
    const key = activeNodeKey.current;
    if (!key) return;
    // An empty URL removes the link whatever the Text field holds (F-EDIT-22.6).
    if (!url.trim()) { removeByKey(key); return; }
    setOpen(false);
    activeNodeKey.current = null;
    editor.update(() => {
      const node = $getNodeByKey(key);
      if (!$isInlineLinkNode(node)) return;
      node.setURL(url);
      setLabel(node, text.trim() || url);
      caretAfter(node);
    });
  };

  const closeWithoutSaving = () => {
    const key = activeNodeKey.current;
    if (!key) return;
    if (!urlVal.trim()) { removeByKey(key); return; }
    const savedUrl = originalUrl.current;
    const savedText = originalText.current;
    setOpen(false);
    activeNodeKey.current = null;
    editor.update(() => {
      const node = $getNodeByKey(key);
      if (!$isInlineLinkNode(node)) return;
      node.setURL(savedUrl);
      setLabel(node, savedText);
      caretAfter(node);
    });
  };

  const removeLink = () => {
    const key = activeNodeKey.current;
    if (key) removeByKey(key);
  };

  if (!open || pos === null) return null;

  return (
    <div
      className="pb-inline-link-editor"
      style={{ position: 'fixed', left: pos.x, top: pos.y }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <input
        ref={inputRef}
        className="pb-inline-link-editor__input pb-inline-link-editor__input--text"
        aria-label="Link text"
        placeholder="Text"
        title="Display text — defaults to the URL when left empty"
        value={textVal}
        onChange={(e) => setTextVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(textVal, urlVal); }
          if (e.key === 'Escape') { e.preventDefault(); closeWithoutSaving(); }
        }}
      />
      <input
        ref={urlInputRef}
        className="pb-inline-link-editor__input pb-inline-link-editor__input--url"
        aria-label="Link URL"
        placeholder="https://…"
        value={urlVal}
        onChange={(e) => setUrlVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(textVal, urlVal); }
          if (e.key === 'Escape') { e.preventDefault(); closeWithoutSaving(); }
        }}
      />
      <button type="button" className="pb-inline-link-editor__btn pb-inline-link-editor__btn--apply" aria-label="Apply link" title="Apply (Enter)" onClick={() => commit(textVal, urlVal)}>
        ✓
      </button>
      <button type="button" className="pb-inline-link-editor__btn pb-inline-link-editor__btn--remove" aria-label="Remove link" onClick={removeLink}>
        ✕
      </button>
    </div>
  );
}

/** Ensures the document always ends with an empty paragraph so the user can click below all content and start typing. */
function TrailingParagraphPlugin() {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    return editor.registerUpdateListener(() => {
      const needsTrailing = editor.getEditorState().read(() => {
        const last = $getRoot().getLastChild();
        return !($isParagraphNode(last) && last.getTextContent() === '');
      });
      if (needsTrailing) {
        editor.update(() => {
          const last = $getRoot().getLastChild();
          if (!($isParagraphNode(last) && last.getTextContent() === '')) {
            $getRoot().append($createParagraphNode());
          }
        });
      }
    });
  }, [editor]);
  return null;
}

/** SVG icons per widget kind — styled after Google Docs toolbar icons. */
const WIDGET_ICON: Record<WidgetDescriptor['kind'], ReactNode> = {
  // Heading 1 (H + superscript 1) — GDocs format_h1
  title: (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <line x1="4" y1="5" x2="4" y2="19" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
      <line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
      <line x1="4" y1="12" x2="12" y2="12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
      <line x1="16" y1="8" x2="16" y2="15" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      <line x1="14.5" y1="9.8" x2="16" y2="8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  ),
  // Pilcrow (¶) — GDocs format_paragraph / Normal text
  text: (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M9 5h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      <path d="M15 5v14" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      <path d="M12 5v14" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      <path d="M9 5a4 4 0 0 0 0 8h3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  // Checklist — GDocs checklist (⇧⌘9)
  chips: (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="3" y="5" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="2"/>
      <polyline points="4.5,8 6,9.5 8,6.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
      <line x1="12" y1="8" x2="21" y2="8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      <rect x="3" y="14" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="2"/>
      <line x1="12" y1="17" x2="21" y2="17" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  ),
  // Bulleted list — GDocs format_list_bulleted (⇧⌘8)
  list: (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="4" cy="7" r="1.5"/>
      <line x1="8" y1="7" x2="20" y2="7" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      <circle cx="4" cy="12" r="1.5"/>
      <line x1="8" y1="12" x2="20" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      <circle cx="4" cy="17" r="1.5"/>
      <line x1="8" y1="17" x2="20" y2="17" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  ),
  // Chain link — GDocs insert_link (⌘K)
  link: (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
    </svg>
  ),
  // Timeline — dots on a horizontal axis (custom, no GDocs equivalent)
  timeline: (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <line x1="2" y1="12" x2="22" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      <circle cx="6" cy="12" r="2.5" fill="currentColor"/>
      <line x1="6" y1="6" x2="6" y2="9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      <circle cx="15" cy="12" r="2.5" fill="currentColor"/>
      <line x1="15" y1="14.5" x2="15" y2="18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  ),
};

// Keyboard shortcuts matching Word conventions where applicable.
// title  → Ctrl+Alt+1    (Word: Heading 1)
// text   → Ctrl+Shift+N  (Word: Normal)
// list   → Ctrl+Shift+L  (Word: List Bullet)
// link   → Ctrl+K        (Word: Hyperlink)
// chips, timeline → custom (no Word equivalent)
interface HotkeyDef { code: string; shift: boolean; alt: boolean; }
const WIDGET_HOTKEY: Record<WidgetDescriptor['kind'], HotkeyDef> = {
  title:    { code: 'Digit1', shift: false, alt: true  },  // Ctrl+Alt+1   — GDocs: Heading 1
  text:     { code: 'Digit0', shift: false, alt: true  },  // Ctrl+Alt+0   — GDocs: Normal text
  list:     { code: 'Digit8', shift: true,  alt: false },  // Ctrl+Shift+8 — GDocs: Bulleted list
  chips:    { code: 'Digit9', shift: true,  alt: false },  // Ctrl+Shift+9 — GDocs: Checklist
  link:     { code: 'KeyK',   shift: false, alt: false },  // Ctrl+K       — GDocs: Insert link
  timeline: { code: 'Digit6', shift: true,  alt: false },  // Ctrl+Shift+6 — custom
};

const IS_MAC =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

function codeToKey(code: string): string {
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Key')) return code.slice(3);
  return code;
}

function hotkeyLabel(kind: WidgetDescriptor['kind']): string {
  const { code, shift, alt } = WIDGET_HOTKEY[kind];
  const key = codeToKey(code);
  if (IS_MAC) {
    return `${alt ? '⌥' : ''}${shift ? '⇧' : ''}⌘${key}`;
  }
  return `Ctrl+${alt ? 'Alt+' : ''}${shift ? 'Shift+' : ''}${key}`;
}

function hotkeyAriaLabel(kind: WidgetDescriptor['kind']): string {
  const { code, shift, alt } = WIDGET_HOTKEY[kind];
  const key = codeToKey(code);
  if (IS_MAC) {
    return `${alt ? 'Option+' : ''}${shift ? 'Shift+' : ''}Meta+${key}`;
  }
  return `Control+${alt ? 'Alt+' : ''}${shift ? 'Shift+' : ''}${key}`;
}

/**
 * Controls side rail (US-EDIT-15 / §13.2.5). Widgets are now inserted directly
 * at root level (after the root-level node containing the caret, or at the end).
 * The 'title' widget is first.
 */
function ControlRail() {
  const [editor] = useLexicalComposerContext();
  // The flow container that holds the caret, used to scope the rail to widgets
  // valid there (US-EDIT-20 / F-EDIT-14.3). Only 'entry' diverges from the
  // historical root-level behaviour; everything else falls back to 'root'.
  const [containerType, setContainerType] = useState<NodeType>('root');

  useEffect(() => {
    return editor.registerUpdateListener(() => {
      editor.getEditorState().read(() => {
        setContainerType(caretContainerType());
      });
    });
  }, [editor]);

  const insertWidget = (widget: WidgetDescriptor) => {
    // Link → always an inline link (spec §15 / US-EDIT-21), never a block line.
    if (widget.kind === 'link') {
      const { hasSelection, allowed } = editor.getEditorState().read(() => {
        const sel = $getSelection();
        if (!$isRangeSelection(sel)) return { hasSelection: false, allowed: false };
        // Inline links belong in running prose only — not in single-line title or
        // entry title/dates fields (spec §15 out of scope).
        return { hasSelection: !sel.isCollapsed(), allowed: caretAllowsInlineLink(sel.anchor.getNode()) };
      });
      if (!allowed) return;
      if (hasSelection) {
        // Wrap the selection; its text becomes the link label.
        editor.dispatchCommand(TOGGLE_LINK_COMMAND, LINK_URL_PLACEHOLDER);
      } else {
        // Collapsed caret → insert an inline link at the caret. The label mirrors
        // the URL (F-EDIT-21.3): seed both with the placeholder so the floating
        // editor (which shows the placeholder as empty) can rewrite the label
        // when a real URL is committed.
        editor.update(() => {
          const sel = $getSelection();
          if (!$isRangeSelection(sel)) return;
          const link = $createInlineLinkNode(LINK_URL_PLACEHOLDER);
          const label = $createPbTextNode(undefined, LINK_URL_PLACEHOLDER);
          link.append(label);
          sel.insertNodes([link]);
          label.selectEnd();
        });
      }
      return;
    }
    editor.update(() => {
      // When the caret is inside a timeline entry, insert into the entry's
      // content (F-EDIT-14.1) — but only widgets the entry accepts; a
      // timeline/title hotkey fired there is a no-op (F-EDIT-14.3).
      const entry = entryContentAnchor();
      if (entry) {
        const allowed = new Set(widgetsAllowedIn('entry').map((w) => w.kind));
        if (!allowed.has(widget.kind)) return;
        const newNode = $createLexicalNode(widget.make());
        if (entry.after) entry.after.insertAfter(newNode);
        else entry.node.append(newNode);
        if (newNode instanceof ElementNode) newNode.selectStart();
        return;
      }
      // Default: insert the block widget at the root-level anchor.
      const newNode = $createLexicalNode(widget.make());
      const anchor = rootLevelAnchor();
      if (anchor) {
        anchor.insertAfter(newNode);
      } else {
        $getRoot().append(newNode);
      }
      if (newNode instanceof ElementNode) {
        newNode.selectStart();
      }
    });
  };

  useEffect(() => {
    return editor.registerCommand(
      KEY_DOWN_COMMAND,
      (event: KeyboardEvent) => {
        const mod = IS_MAC ? event.metaKey : event.ctrlKey;
        if (!mod) return false;
        const widget = WIDGETS.find((w) => {
          const hk = WIDGET_HOTKEY[w.kind];
          return event.code === hk.code && event.shiftKey === hk.shift && event.altKey === hk.alt;
        });
        if (!widget) return false;
        event.preventDefault();
        insertWidget(widget);
        return true;
      },
      COMMAND_PRIORITY_NORMAL,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  const visibleWidgets =
    containerType === 'entry' ? widgetsAllowedIn('entry') : WIDGETS;

  return (
    <div className="pb-rail" role="toolbar" aria-label="Insert controls" aria-orientation="vertical">
      {visibleWidgets.map((w) => (
        <button
          key={w.kind}
          type="button"
          className="pb-rail__item"
          aria-label={`${w.name} (${hotkeyLabel(w.kind)}) — ${w.description}`}
          aria-keyshortcuts={hotkeyAriaLabel(w.kind)}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => insertWidget(w)}
        >
          <span className="pb-rail__icon" aria-hidden="true">{WIDGET_ICON[w.kind]}</span>
          <span className="pb-rail__tip" role="tooltip" aria-hidden="true">
            <span className="pb-rail__tip-name">{w.name}</span>
            <kbd className="pb-rail__tip-key">{hotkeyLabel(w.kind)}</kbd>
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * Whether an inline link may be created at `node`'s position. Links belong in
 * running prose (paragraphs, list items), not in the single-line title or entry
 * title/dates fields (spec §15 out of scope). Must be called inside read/update.
 */
function caretAllowsInlineLink(node: LexicalNode): boolean {
  let cur: LexicalNode | null = node;
  while (cur) {
    if ($isTitleNode(cur) || $isEntryFieldNode(cur)) return false;
    cur = cur.getParent();
  }
  return true;
}

/**
 * The root-level node that contains (or precedes) the current selection, used
 * as the insertion point for new widgets. Must be called inside editor.update/read.
 */
function rootLevelAnchor(): LexicalNode | null {
  const selection = $getSelection();
  if ($isRangeSelection(selection)) {
    let node: LexicalNode | null = selection.anchor.getNode();
    while (node && node.getParent() !== $getRoot()) node = node.getParent();
    if (node) return node;
  }
  const children = $getRoot().getChildren();
  return children.length ? children[children.length - 1] : null;
}

/**
 * If the caret sits inside a timeline entry, return that entry's lexical node
 * plus the entry-content block after which a new widget should be inserted
 * (US-EDIT-20 / F-EDIT-14.1). `after` is the entry's direct child holding the
 * caret; when the caret is in the title/dates field it is the entry's last
 * content block (or null → append). Returns null when the caret is not in an
 * entry. Must be called inside editor.update/read.
 */
function entryContentAnchor(): { node: ElementNode; after: LexicalNode | null } | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return null;
  let node: LexicalNode | null = selection.anchor.getNode();
  while (node) {
    const parent: LexicalNode | null = node.getParent();
    if (parent && $isEntryNode(parent)) {
      // `node` is the entry's direct child containing the caret.
      if ($isEntryFieldNode(node)) {
        // Caret in the title/dates row → append after the last content block.
        const content = parent.getChildren().filter((c) => !$isEntryFieldNode(c));
        return { node: parent, after: content.length ? content[content.length - 1] : null };
      }
      return { node: parent, after: node };
    }
    node = parent;
  }
  return null;
}

/**
 * The flow-container type holding the caret, for scoping the insert rail.
 * Currently only distinguishes 'entry' (timeline entry content) from 'root';
 * any other location falls back to 'root'. Must be called inside read/update.
 */
function caretContainerType(): NodeType {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return 'root';
  let node: LexicalNode | null = selection.anchor.getNode();
  while (node) {
    if ($isEntryNode(node)) return 'entry';
    node = node.getParent();
  }
  return 'root';
}

/** One positioned button per timeline, rendered as an overlay below the last entry. */
function AddEntryButtons() {
  const [editor] = useLexicalComposerContext();
  const [timelines, setTimelines] = useState<{ key: string; top: number }[]>([]);

  useEffect(() => {
    const recompute = () => {
      const root = editor.getRootElement();
      const base = root ? root.getBoundingClientRect().top : 0;
      const next: { key: string; top: number }[] = [];
      editor.getEditorState().read(() => {
        for (const child of $getRoot().getChildren()) {
          if (!$isTimelineNode(child)) continue;
          const el = editor.getElementByKey(child.getKey());
          if (el) next.push({ key: child.getKey(), top: el.getBoundingClientRect().bottom - base });
        }
      });
      setTimelines(next);
    };
    recompute();
    const unregister = editor.registerUpdateListener(recompute);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(recompute) : null;
    const root = editor.getRootElement();
    if (root && ro) ro.observe(root);
    return () => { unregister(); ro?.disconnect(); };
  }, [editor]);

  const addEntry = (timelineKey: string) => {
    editor.update(() => {
      const node = editor.getEditorState().read(() =>
        $getRoot().getChildren().find((n) => n.getKey() === timelineKey),
      );
      if (!$isTimelineNode(node)) return;
      const entry = $createEntryNode();
      const title = $createEntryFieldNode('title');
      title.append($createPbTextNode(undefined, ''));
      const dates = $createEntryFieldNode('dates');
      dates.append($createPbTextNode(undefined, ''));
      const desc = $createPbParagraphNode();
      desc.append($createPbTextNode(undefined, ''));
      entry.append(title, dates, desc);
      (node as ElementNode).append(entry);
      title.selectEnd();
    });
  };

  return (
    <>
      {timelines.map(({ key, top }) => (
        <button
          key={key}
          type="button"
          className="pb-add-entry"
          style={{ top }}
          onClick={() => addEntry(key)}
        >
          + Add entry
        </button>
      ))}
    </>
  );
}

/** Small remove icon overlaid at the left gutter of each timeline entry. */
function RemoveEntryButtons() {
  const [editor] = useLexicalComposerContext();
  const [entries, setEntries] = useState<{ key: string; timelineKey: string; top: number }[]>([]);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleLeave = () => {
    leaveTimer.current = setTimeout(() => setHoveredKey(null), 80);
  };
  const cancelLeave = () => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
  };

  useEffect(() => {
    const cleanupHover: (() => void)[] = [];

    const recompute = () => {
      cleanupHover.forEach((fn) => fn());
      cleanupHover.length = 0;

      const root = editor.getRootElement();
      const base = root ? root.getBoundingClientRect().top : 0;
      const next: typeof entries = [];
      editor.getEditorState().read(() => {
        for (const child of $getRoot().getChildren()) {
          if (!$isTimelineNode(child)) continue;
          for (const entry of (child as ElementNode).getChildren()) {
            if (!$isEntryNode(entry)) continue;
            const el = editor.getElementByKey(entry.getKey());
            if (!el) continue;
            const titleEl = el.querySelector('[data-pb="entry-title"]') as HTMLElement | null;
            const ref = titleEl ?? el;
            const r = ref.getBoundingClientRect();
            const key = entry.getKey();
            next.push({ key, timelineKey: child.getKey(), top: r.top + r.height / 2 - base });

            const onEnter = () => { cancelLeave(); setHoveredKey(key); };
            const onLeave = () => scheduleLeave();
            el.addEventListener('mouseenter', onEnter);
            el.addEventListener('mouseleave', onLeave);
            cleanupHover.push(() => {
              el.removeEventListener('mouseenter', onEnter);
              el.removeEventListener('mouseleave', onLeave);
            });
          }
        }
      });
      setEntries(next);
    };

    recompute();
    const unregister = editor.registerUpdateListener(recompute);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(recompute) : null;
    const root = editor.getRootElement();
    if (root && ro) ro.observe(root);
    return () => {
      unregister();
      ro?.disconnect();
      cleanupHover.forEach((fn) => fn());
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  const removeEntry = (entryKey: string, timelineKey: string) => {
    editor.update(() => {
      const timeline = $getNodeByKey(timelineKey);
      const entry = $getNodeByKey(entryKey);
      if (!$isEntryNode(entry)) return;
      if ($isTimelineNode(timeline) && (timeline as ElementNode).getChildrenSize() <= 1) {
        timeline.remove();
      } else {
        entry.remove();
      }
    });
  };

  return (
    <>
      {entries.map(({ key, top, timelineKey }) => (
        <button
          key={key}
          type="button"
          className={`pb-remove-entry${hoveredKey === key ? ' pb-remove-entry--visible' : ''}`}
          style={{ top }}
          aria-label="Remove entry"
          onMouseEnter={() => { cancelLeave(); setHoveredKey(key); }}
          onMouseLeave={() => scheduleLeave()}
          onClick={() => removeEntry(key, timelineKey)}
        >
          ✕
        </button>
      ))}
    </>
  );
}

interface TitleHandle {
  key: string;
  top: number;
}

/**
 * Returns all root-level node keys that form the group anchored by `titleKey`:
 * the title node itself plus all consecutive non-title nodes that follow it.
 * Must be called inside editor.update/read.
 */
function titleGroupKeys(titleNode: LexicalNode): string[] {
  const keys: string[] = [titleNode.getKey()];
  let sibling = titleNode.getNextSibling();
  while (sibling && !$isTitleNode(sibling)) {
    keys.push(sibling.getKey());
    sibling = sibling.getNextSibling();
  }
  return keys;
}

/**
 * Title group reorder controls (F-EDIT-19.4 / F-EDIT-19.5 / §13.2.5).
 * One gutter group per title node: drag handle + ▲ ▼ + ✕.
 * Dragging moves the entire title group (title + all non-title followers).
 */
function TitleControls() {
  const [editor] = useLexicalComposerContext();
  const [handles, setHandles] = useState<TitleHandle[]>([]);
  const [hoveredTitleKey, setHoveredTitleKey] = useState<string | null>(null);
  const dragKey = useRef<string | null>(null);
  const dropTarget = useRef<{ key: string; place: 'before' | 'after' } | null>(null);
  const [dropLineY, setDropLineY] = useState<number | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number; html: string; width: number } | null>(null);

  useEffect(() => {
    const cleanupHover: (() => void)[] = [];

    const recompute = () => {
      cleanupHover.forEach((fn) => fn());
      cleanupHover.length = 0;

      const root = editor.getRootElement();
      const base = root ? root.getBoundingClientRect().top : 0;
      const next: TitleHandle[] = [];
      editor.getEditorState().read(() => {
        const titles = $getRoot()
          .getChildren()
          .filter((n): n is ElementNode => $isTitleNode(n));
        titles.forEach((node) => {
          const key = node.getKey();
          const el = editor.getElementByKey(key);
          next.push({ key, top: el ? el.getBoundingClientRect().top - base : 0 });
          if (el) {
            const onEnter = () => setHoveredTitleKey(key);
            const onLeave = () => setHoveredTitleKey((k) => (k === key ? null : k));
            el.addEventListener('mouseenter', onEnter);
            el.addEventListener('mouseleave', onLeave);
            cleanupHover.push(() => {
              el.removeEventListener('mouseenter', onEnter);
              el.removeEventListener('mouseleave', onLeave);
            });
          }
        });
      });
      setHandles(next);
    };
    recompute();
    const unregister = editor.registerUpdateListener(recompute);
    window.addEventListener('resize', recompute);
    return () => {
      unregister();
      window.removeEventListener('resize', recompute);
      cleanupHover.forEach((fn) => fn());
    };
  }, [editor]);

  /** Reorder: move source group before/after the target title group. */
  const reorderGroup = (sourceKey: string, place: 'before' | 'after', targetKey: string) =>
    editor.update(() => {
      const sourceNode = $getNodeByKey(sourceKey);
      const targetNode = $getNodeByKey(targetKey);
      if (!$isTitleNode(sourceNode) || !$isTitleNode(targetNode) || sourceKey === targetKey) return;
      const groupKeys = titleGroupKeys(sourceNode);
      if (place === 'before') {
        for (const k of groupKeys) {
          const n = $getNodeByKey(k);
          if (n) targetNode.insertBefore(n);
        }
      } else {
        // Insert after the last node of the target group.
        const targetGroupKeys = titleGroupKeys(targetNode);
        const targetLastKey = targetGroupKeys[targetGroupKeys.length - 1];
        let insertAfter = $getNodeByKey(targetLastKey);
        if (!insertAfter) return;
        for (const k of groupKeys) {
          const n = $getNodeByKey(k);
          if (n) { insertAfter.insertAfter(n); insertAfter = n; }
        }
      }
    });

  // Resolve the drop target (title group) from pointer Y.
  // Groups are contiguous spans: group[i] runs from handles[i].top to handles[i+1].top
  // (or to the editor's bottom for the last group). We use the full group span for
  // midpoint detection and for placing the drop line — not just the title element rect —
  // so the indicator never lands inside a timeline or other tall widget.
  const dropGroupTargetAt = (
    clientY: number,
  ): { key: string; place: 'before' | 'after'; lineY: number } | null => {
    if (handles.length === 0) return null;
    const root = editor.getRootElement();
    const rootRect = root?.getBoundingClientRect();
    const base = rootRect ? rootRect.top : 0;
    const rootBottom = rootRect ? rootRect.bottom - base : clientY - base;
    const y = clientY - base;

    // Find the handle whose group contains y (last handle with top ≤ y).
    let idx = 0;
    for (let i = 0; i < handles.length; i++) {
      if (handles[i].top <= y) idx = i;
    }
    const h = handles[idx];
    if (h.key === dragKey.current) return null;

    // Full group spans from h.top down to the next group's top (or root bottom).
    const groupTop = h.top;
    const groupBottom = idx + 1 < handles.length ? handles[idx + 1].top : rootBottom;
    const place: 'before' | 'after' = y < (groupTop + groupBottom) / 2 ? 'before' : 'after';

    // Drop line sits at the gap between groups (just above the boundary title).
    const lineY = place === 'before' ? groupTop - 4 : groupBottom - 4;
    return { key: h.key, place, lineY };
  };

  const startDrag = (key: string, e: React.MouseEvent) => {
    e.preventDefault();
    dragKey.current = key;
    dropTarget.current = null;
    // Build the ghost from the group's DOM nodes concatenated.
    let html = '';
    let width = 0;
    editor.getEditorState().read(() => {
      const node = $getNodeByKey(key);
      if (!$isTitleNode(node)) return;
      for (const k of titleGroupKeys(node)) {
        const el = editor.getElementByKey(k);
        if (el) { html += el.outerHTML; width = Math.max(width, el.getBoundingClientRect().width); }
      }
    });
    setGhost({ x: e.clientX, y: e.clientY, html, width });

    const onMove = (ev: MouseEvent) => {
      setGhost((g) => (g ? { ...g, x: ev.clientX, y: ev.clientY } : g));
      const target = dropGroupTargetAt(ev.clientY);
      dropTarget.current = target ? { key: target.key, place: target.place } : null;
      setDropLineY(target ? target.lineY : null);
    };
    const onUp = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      const source = dragKey.current;
      const target = dropGroupTargetAt(ev.clientY);
      dragKey.current = null;
      dropTarget.current = null;
      setGhost(null);
      setDropLineY(null);
      if (source && target) reorderGroup(source, target.place, target.key);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  if (handles.length === 0) return null;

  return (
    <div className="pb-title-rail" aria-label="Reorder sections">
      {ghost && (
        <div
          className="pb-drag-ghost pb-drag-ghost--floating"
          style={{ left: ghost.x + 14, top: ghost.y + 10, width: ghost.width || undefined }}
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: ghost.html }}
        />
      )}
      {dropLineY !== null && (
        <div className="pb-drop-line" style={{ top: dropLineY }} aria-hidden="true" />
      )}
      {handles.map((h) => (
        <div
          key={h.key}
          className={`pb-title-rail__group${hoveredTitleKey === h.key ? ' pb-title-rail__group--visible' : ''}`}
          style={{ top: h.top }}
        >
          <button
            type="button"
            className="pb-rail-btn pb-rail-handle"
            aria-label="Drag to reorder section"
            title="Drag to reorder"
            onMouseDown={(e) => startDrag(h.key, e)}
          >
            ⠿
          </button>
        </div>
      ))}
    </div>
  );
}

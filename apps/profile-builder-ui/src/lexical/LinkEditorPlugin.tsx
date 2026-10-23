import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { AutoLinkPlugin, createLinkMatcherWithRegExp } from '@lexical/react/LexicalAutoLinkPlugin';
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin';
import {
  $createLinkNode,
  $isAutoLinkNode,
  $isLinkNode,
  LinkNode,
  TOGGLE_LINK_COMMAND,
} from '@lexical/link';
import { $findMatchingParent, mergeRegister } from '@lexical/utils';
import {
  $getNodeByKey,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  COMMAND_PRIORITY_EDITOR,
  COMMAND_PRIORITY_LOW,
  COMMAND_PRIORITY_NORMAL,
  ElementNode,
  KEY_ESCAPE_COMMAND,
  LexicalNode,
  NodeKey,
  PointType,
  RangeSelection,
  createCommand,
} from 'lexical';
import {
  $createPbTextNode,
  $isEntryFieldNode,
  $isSectionHeadingNode,
  $isTitleNode,
  registerLinkIds,
} from './widget-nodes';

// Inline links (stock @lexical/link LinkNode) and their one floating editor,
// modelled on the Lexical playground's FloatingLinkEditor. Three modes:
//   • wrap   — mod+K / rail Link over a non-empty selection → URL field
//   • insert — mod+K / rail Link at a collapsed caret      → Text + URL fields
//   • view   — caret inside an existing link               → URL, Edit, Remove
// (Edit turns view into an `edit` form for the URL.) Nothing is written into the
// document until the form is confirmed: the editor remembers the selection it
// was opened on and applies the link to it then. Escape / ✕ / clicking away
// cancels and leaves the document as it was.

/** Open the link editor for the current selection (mod+K and the rail's Link button). */
export const OPEN_LINK_EDITOR_COMMAND = createCommand<void>('OPEN_LINK_EDITOR_COMMAND');

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
/** A bare host (`example.com`, `www.me.dev:8080/cv`, `localhost:3000`), optionally with a path. */
const BARE_DOMAIN = /^(localhost|([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,})(:\d+)?([/?#]\S*)?$/i;
const BARE_EMAIL = /^[^\s@/:]+@[^\s@/:]+\.[^\s@/:]+$/;

/** Whether `url` is absolute, parses, and uses a protocol a CV link may carry. */
export function isAllowedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) return false;
    return parsed.protocol === 'mailto:' || parsed.protocol === 'tel:' || parsed.hostname !== '';
  } catch {
    return false;
  }
}

/**
 * What the user typed as a link URL, made absolute — or null if it is not a URL
 * we accept. Trimmed; a bare domain gets `https://`, a bare email `mailto:`.
 * Only http(s), mailto and tel are accepted (never e.g. `javascript:`).
 */
export function normalizeUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  let url: string;
  if (BARE_EMAIL.test(value)) url = `mailto:${value}`;
  // `localhost:3000` looks like a scheme too; a bare host wins.
  else if (BARE_DOMAIN.test(value)) url = `https://${value}`;
  else if (SCHEME.test(value)) url = value;
  else return null;
  return isAllowedUrl(url) ? url : null;
}

// Autolink matchers, after the Lexical playground's AutoLinkPlugin.
const URL_MATCHER =
  /((https?:\/\/(www\.)?)|(www\.))[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&//=]*)(?<![-.+():%])/;
const EMAIL_MATCHER =
  /(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))/;
const AUTOLINK_MATCHERS = [
  createLinkMatcherWithRegExp(URL_MATCHER, (text) => (text.startsWith('http') ? text : `https://${text}`)),
  createLinkMatcherWithRegExp(EMAIL_MATCHER, (text) => `mailto:${text}`),
];

// ---------------------------------------------------------------------------
// Where links may go
// ---------------------------------------------------------------------------

/** Single-line fields that hold plain text only: titles and entry title/dates. */
function isPlainTextField(node: ElementNode): boolean {
  return $isTitleNode(node) || $isEntryFieldNode(node) || $isSectionHeadingNode(node);
}

// Module-level so the plugin sees the same array every render: AutoLinkPlugin
// re-registers (and re-dirties every text node) whenever it changes identity.
const AUTOLINK_EXCLUDED = [isPlainTextField];

function $pointAllowsLink(point: PointType): boolean {
  return $findMatchingParent(point.getNode(), (n) => n instanceof ElementNode && isPlainTextField(n)) === null;
}

/**
 * Whether a link may be created over `selection`: anywhere in running text
 * (paragraphs, list items, entry descriptions), never in a title or an entry's
 * Title / Dates field. Chips are a decorator, so a range selection never lands
 * in one. Must be called inside read/update.
 */
export function $selectionAllowsLink(selection: RangeSelection): boolean {
  return $pointAllowsLink(selection.anchor) && $pointAllowsLink(selection.focus);
}

/** The (live) link both ends of `selection` sit in, or null. */
function $linkAtSelection(selection: RangeSelection): LinkNode | null {
  const anchor = $findMatchingParent(selection.anchor.getNode(), $isLinkNode);
  const focus = $findMatchingParent(selection.focus.getNode(), $isLinkNode);
  if (!anchor || !focus || !anchor.is(focus)) return null;
  // An autolink the user removed stays in the tree as plain text.
  if ($isAutoLinkNode(anchor) && anchor.getIsUnlinked()) return null;
  return anchor;
}

function $pointIsAlive(point: PointType): boolean {
  return $getNodeByKey(point.key)?.isAttached() ?? false;
}

/**
 * Put the caret just after `link`, outside it, so typing continues as plain
 * text. With no text run after the link there is no such position yet; an empty
 * run is created for it (the serializer drops it while it stays empty).
 */
function $selectAfter(link: LexicalNode): void {
  const next = link.getNextSibling();
  if ($isTextNode(next)) {
    next.select(0, 0);
    return;
  }
  const tail = $createPbTextNode(undefined, '');
  link.insertAfter(tail);
  tail.select(0, 0);
}

// ---------------------------------------------------------------------------
// The plugin
// ---------------------------------------------------------------------------

type Mode =
  | { kind: 'closed' }
  | { kind: 'wrap' | 'insert'; selection: RangeSelection }
  | { kind: 'view' | 'edit'; linkKey: NodeKey; url: string; selection: RangeSelection | null };

const CLOSED: Mode = { kind: 'closed' };

const DIALOG_LABEL: Record<Exclude<Mode['kind'], 'closed'>, string> = {
  wrap: 'Add link',
  insert: 'Insert link',
  view: 'Link',
  edit: 'Edit link',
};

/**
 * Link support for the builder: stock LinkPlugin (TOGGLE_LINK_COMMAND, and
 * pasting a URL over a selection wraps it), AutoLinkPlugin (typed / pasted
 * URLs), the stable-id transform, and the floating link editor. There is no
 * ClickableLinkPlugin: clicking a link places the caret, and navigation happens
 * only from the editor's URL anchor.
 */
export function LinkEditorPlugin() {
  const [editor] = useLexicalComposerContext();
  const [mode, setModeState] = useState<Mode>(CLOSED);
  const modeRef = useRef<Mode>(CLOSED);
  const [textVal, setTextVal] = useState('');
  const [urlVal, setUrlVal] = useState('');
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);
  // The DOM range a wrap/insert was opened on, to anchor the popover.
  const rangeRef = useRef<Range | null>(null);
  // A link whose view the user dismissed (Escape); stays closed until the caret leaves it.
  const dismissedKey = useRef<NodeKey | null>(null);
  // Set when a form opens; its first input is focused once the popover is placed.
  const focusPending = useRef(false);
  // The latest cancel(), for the editor's Escape command.
  const cancelRef = useRef<() => void>(() => {});

  const setMode = (next: Mode) => {
    if (next.kind !== modeRef.current.kind) {
      focusPending.current = next.kind === 'wrap' || next.kind === 'insert' || next.kind === 'edit';
    }
    modeRef.current = next;
    setModeState(next);
  };
  const close = () => setMode(CLOSED);

  useEffect(() => registerLinkIds(editor), [editor]);

  // Open from mod+K / the rail, and keep links out of plain-text fields.
  useEffect(() => {
    return mergeRegister(
      editor.registerCommand(
        OPEN_LINK_EDITOR_COMMAND,
        () => {
          const selection = $getSelection();
          // Outside running text the command is a no-op.
          if (!$isRangeSelection(selection) || !$selectionAllowsLink(selection)) return true;
          const domSelection = window.getSelection();
          rangeRef.current = domSelection && domSelection.rangeCount > 0 ? domSelection.getRangeAt(0).cloneRange() : null;
          const link = $linkAtSelection(selection);
          if (link) {
            setUrlVal(link.getURL());
            setMode({ kind: 'edit', linkKey: link.getKey(), url: link.getURL(), selection: selection.clone() });
          } else {
            setTextVal('');
            setUrlVal('');
            setMode({ kind: selection.isCollapsed() ? 'insert' : 'wrap', selection: selection.clone() });
          }
          return true;
        },
        COMMAND_PRIORITY_EDITOR,
      ),
      editor.registerCommand(
        TOGGLE_LINK_COMMAND,
        (payload) => {
          const selection = $getSelection();
          // Swallow any attempt (paste, a stray command) to link title / field text.
          return payload !== null && $isRangeSelection(selection) && !$selectionAllowsLink(selection);
        },
        COMMAND_PRIORITY_NORMAL,
      ),
      editor.registerCommand(
        KEY_ESCAPE_COMMAND,
        (event) => {
          // Escape with focus still in the document (e.g. right after mod+K):
          // cancel whatever is open, as Escape in the form's inputs does.
          if (modeRef.current.kind === 'closed') return false;
          event?.preventDefault();
          cancelRef.current();
          return true;
        },
        COMMAND_PRIORITY_LOW,
      ),
    );
  }, [editor]);

  // Follow the caret: entering a link opens its view; leaving it closes it. An
  // open form ignores selection changes (focus is in its inputs) but closes if
  // what it was opened on disappears, e.g. the host reloads the document.
  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const current = modeRef.current;
        if (current.kind === 'wrap' || current.kind === 'insert') {
          if (!$pointIsAlive(current.selection.anchor) || !$pointIsAlive(current.selection.focus)) close();
          return;
        }
        if (current.kind === 'edit') {
          if (!$isLinkNode($getNodeByKey(current.linkKey))) close();
          return;
        }
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) {
          // Blur (e.g. pointer over the popover) keeps the view, unless its link went away.
          if (current.kind === 'view' && !$isLinkNode($getNodeByKey(current.linkKey))) close();
          return;
        }
        const link = $linkAtSelection(selection);
        if (!link) {
          dismissedKey.current = null;
          if (current.kind === 'view') close();
          return;
        }
        if (link.getKey() === dismissedKey.current) return;
        if (current.kind === 'view' && current.linkKey === link.getKey() && current.url === link.getURL()) {
          current.selection = selection.clone();
          return;
        }
        setMode({ kind: 'view', linkKey: link.getKey(), url: link.getURL(), selection: selection.clone() });
      });
    });
  }, [editor]);

  // Anchor the popover under the link (view / edit) or the selection (wrap / insert).
  useLayoutEffect(() => {
    if (mode.kind === 'closed') {
      setPos(null);
      return;
    }
    const place = () => {
      const current = modeRef.current;
      let rect: DOMRect | undefined;
      if (current.kind === 'view' || current.kind === 'edit') {
        rect = editor.getElementByKey(current.linkKey)?.getBoundingClientRect();
      } else if (current.kind === 'wrap' || current.kind === 'insert') {
        const range = rangeRef.current;
        rect = typeof range?.getBoundingClientRect === 'function' ? range.getBoundingClientRect() : undefined;
        if (!rect || (rect.width === 0 && rect.height === 0 && rect.top === 0)) {
          rect = editor.getElementByKey(current.selection.anchor.key)?.getBoundingClientRect();
        }
      }
      if (!rect) return;
      const width = dialogRef.current?.offsetWidth ?? 0;
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      setPos({ left, top: rect.bottom + 6 });
    };
    place();
    const unregister = editor.registerUpdateListener(place);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      unregister();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [editor, mode]);

  // A form takes focus when it opens — Text first when inserting, else the URL —
  // but only once it is placed: until then the popover is visibility:hidden, and
  // a hidden input cannot take focus (the caret would stay in the document).
  useEffect(() => {
    if (!focusPending.current || pos === null) return;
    const input = mode.kind === 'insert' ? textInputRef.current : urlInputRef.current;
    if (!input) return;
    focusPending.current = false;
    input.focus();
  }, [mode, pos]);

  // Clicking away cancels a form. A view closes when the click is outside the
  // editor too; inside it, moving the caret decides.
  useEffect(() => {
    if (mode.kind === 'closed') return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (dialogRef.current?.contains(target)) return;
      if (modeRef.current.kind === 'view' && editor.getRootElement()?.contains(target)) return;
      close();
    };
    document.addEventListener('mousedown', onPointerDown, true);
    return () => document.removeEventListener('mousedown', onPointerDown, true);
  }, [editor, mode.kind]);

  /** Close the editor and hand focus back to the document with `$select` applied. */
  const finish = (dismiss: NodeKey | null, $select: () => void) => {
    dismissedKey.current = dismiss;
    close();
    editor.update($select);
    editor.focus();
  };

  const restoreSelection = (selection: RangeSelection | null) => () => {
    if (selection && $pointIsAlive(selection.anchor) && $pointIsAlive(selection.focus)) {
      $setSelection(selection.clone());
    }
  };

  const cancel = () => {
    const current = modeRef.current;
    if (current.kind === 'closed') return;
    const dismiss = current.kind === 'view' || current.kind === 'edit' ? current.linkKey : null;
    finish(dismiss, restoreSelection(current.selection));
  };
  cancelRef.current = cancel;

  // Remove keeps the label as plain text, caret at its end. An autolink is
  // marked unlinked instead of unwrapped, or AutoLink would re-link its text.
  const removeLink = (linkKey: NodeKey) =>
    finish(null, () => {
      const link = $getNodeByKey(linkKey);
      if (!$isLinkNode(link)) return;
      if ($isAutoLinkNode(link)) {
        link.setIsUnlinked(true);
        link.selectEnd();
        return;
      }
      const children = link.getChildren();
      for (const child of children) link.insertBefore(child);
      link.remove();
      children[children.length - 1]?.selectEnd();
    });

  const normalized = normalizeUrl(urlVal);
  const urlEmpty = urlVal.trim() === '';
  const urlInvalid = !urlEmpty && normalized === null;
  // Edit accepts an empty URL: it removes the link.
  const canConfirm = mode.kind === 'edit' ? urlEmpty || normalized !== null : normalized !== null;

  const confirm = () => {
    const current = modeRef.current;
    if (!canConfirm) return;
    if (current.kind === 'edit' && urlEmpty) {
      removeLink(current.linkKey);
      return;
    }
    const url = normalized!;
    if (current.kind === 'wrap') {
      finish(null, () => {
        $setSelection(current.selection.clone());
        editor.dispatchCommand(TOGGLE_LINK_COMMAND, url);
        const selection = $getSelection();
        const link = $isRangeSelection(selection) ? $findMatchingParent(selection.focus.getNode(), $isLinkNode) : null;
        if (link) $selectAfter(link);
      });
    } else if (current.kind === 'insert') {
      const label = textVal.trim() || url;
      finish(null, () => {
        $setSelection(current.selection.clone());
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;
        const link = $createLinkNode(url);
        link.append($createPbTextNode(undefined, label));
        selection.insertNodes([link]);
        $selectAfter(link);
      });
    } else if (current.kind === 'edit') {
      finish(null, () => {
        const link = $getNodeByKey(current.linkKey);
        if (!$isLinkNode(link)) return;
        link.setURL(url);
        $selectAfter(link);
      });
    }
  };

  const onFieldKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      confirm();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    }
  };

  return (
    <>
      <LinkPlugin validateUrl={isAllowedUrl} />
      <AutoLinkPlugin matchers={AUTOLINK_MATCHERS} excludeParents={AUTOLINK_EXCLUDED} />
      {mode.kind !== 'closed' && (
      <div
        ref={dialogRef}
        className={`pb-inline-link-editor pb-inline-link-editor--${mode.kind}`}
        role="dialog"
        aria-label={DIALOG_LABEL[mode.kind]}
        style={{ position: 'fixed', left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}
        // Keep the editor's focus and selection when pressing the popover's
        // buttons; the inputs still take focus normally.
        onMouseDown={(e) => {
          if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
        }}
      >
        {mode.kind === 'view' ? (
          <>
            {isAllowedUrl(mode.url) ? (
              <a className="pb-inline-link-editor__url" href={mode.url} target="_blank" rel="noopener noreferrer">
                {mode.url}
              </a>
            ) : (
              <span className="pb-inline-link-editor__url pb-inline-link-editor__url--unsafe">{mode.url}</span>
            )}
            <button
              type="button"
              className="pb-inline-link-editor__btn"
              aria-label="Edit link"
              title="Edit link"
              onClick={() => {
                setUrlVal(mode.url);
                setMode({ ...mode, kind: 'edit' });
              }}
            >
              Edit
            </button>
            <button
              type="button"
              className="pb-inline-link-editor__btn pb-inline-link-editor__btn--remove"
              aria-label="Remove link"
              title="Remove link (keeps the text)"
              onClick={() => removeLink(mode.linkKey)}
            >
              Remove
            </button>
          </>
        ) : (
          <>
            <div className="pb-inline-link-editor__fields">
              {mode.kind === 'insert' && (
                <input
                  ref={textInputRef}
                  className="pb-inline-link-editor__input pb-inline-link-editor__input--text"
                  aria-label="Link text"
                  placeholder="Text"
                  title="Display text — defaults to the URL when left empty"
                  value={textVal}
                  onChange={(e) => setTextVal(e.target.value)}
                  onKeyDown={onFieldKeyDown}
                />
              )}
              <input
                ref={urlInputRef}
                className="pb-inline-link-editor__input pb-inline-link-editor__input--url"
                aria-label="Link URL"
                aria-invalid={urlInvalid}
                aria-describedby={urlInvalid ? 'pb-link-url-error' : undefined}
                placeholder="https://…"
                inputMode="url"
                value={urlVal}
                onChange={(e) => setUrlVal(e.target.value)}
                onKeyDown={onFieldKeyDown}
              />
              <button
                type="button"
                className="pb-inline-link-editor__btn pb-inline-link-editor__btn--apply"
                aria-label="Apply link"
                title="Apply (Enter)"
                disabled={!canConfirm}
                onClick={confirm}
              >
                ✓
              </button>
              <button
                type="button"
                className="pb-inline-link-editor__btn pb-inline-link-editor__btn--cancel"
                aria-label="Cancel"
                title="Cancel (Esc)"
                onClick={cancel}
              >
                ✕
              </button>
            </div>
            {urlInvalid && (
              <div id="pb-link-url-error" className="pb-inline-link-editor__error">
                Enter a valid URL
              </div>
            )}
          </>
        )}
      </div>
      )}
    </>
  );
}

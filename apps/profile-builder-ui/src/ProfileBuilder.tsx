import { useEffect, useRef, useState } from 'react';
import './ProfileBuilder.css';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  ElementNode,
  LexicalNode,
} from 'lexical';
import {
  ProfileDocument,
  ProfileHeader as ProfileHeaderModel,
  RootNode,
  emptyHeader,
} from './model';
import { WIDGET_NODES, $isSectionNode } from './lexical/widget-nodes';
import { $createLexicalNode, $readBody, loadDocument } from './serialize';
import { WIDGETS, WidgetDescriptor, sectionNode } from './nodes';
import { ProfileHeader } from './components/ProfileHeader';

// Document builder root (spec §9 / ADR-0014). The whole profile body is ONE
// Lexical editor over the neutral BlockNode tree; sections are reorderable
// `section` nodes inside it. Host-agnostic: no fetch/auth/routing. The fixed
// identity/contact `header` (letterhead) lives outside the editor and is edited
// with plain inputs. Only the neutral tree crosses the boundary — never Lexical's
// internal JSON.

export interface ProfileBuilderProps {
  /** Initial document the builder is seeded with. */
  document: ProfileDocument;
  /** Called with the full document on every edit. */
  onChange?: (document: ProfileDocument) => void;
}

const THEME = {
  paragraph: 'pb-paragraph',
  pbSection: 'pb-section',
  pbSectionHeading: 'pb-section__heading',
  pbChips: 'pb-chips',
  pbTimeline: 'pb-workexp',
  pbEntry: 'pb-item',
  pbItemTitle: 'pb-item__title',
  pbItemDates: 'pb-item__dates',
  list: { ul: 'pb-list', listitem: 'pb-list__item', nested: { listitem: 'pb-li--nested' } },
};

export function ProfileBuilder({ document, onChange }: ProfileBuilderProps) {
  const header = document.header ?? emptyHeader();
  // The body tree the editor currently reflects, as JSON, so we can (a) skip
  // re-seeding the editor when the host echoes back the same body, and (b) avoid
  // emitting no-op changes — both of which would otherwise loop or reset the
  // caret in a two-way-bound host.
  const bodyJsonRef = useRef<string>(JSON.stringify(document.body));
  const rootIdRef = useRef<string>(document.body.id);
  rootIdRef.current = document.body.id;

  const emitHeader = (next: ProfileHeaderModel) =>
    onChange?.({ header: next, body: parse(bodyJsonRef.current) });

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
      <ProfileHeader header={header} onChange={emitHeader} />
      <LexicalComposer initialConfig={initialConfig}>
        <InsertToolbar />
        <div className="pb-doc">
          <RichTextPlugin
            contentEditable={<ContentEditable className="pb-content" />}
            placeholder={
              <div className="pb-placeholder">
                Add a section, then type or insert a widget…
              </div>
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
          <SectionControls />
        </div>
        <HistoryPlugin />
        <ListPlugin />
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

/**
 * Seeds the editor from `body` and re-seeds only when the host supplies a body
 * that genuinely differs from what the editor already reflects (compared via the
 * shared `bodyJsonRef`). This preserves local edits and the caret when a
 * two-way-bound host echoes the same document back.
 */
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
    // Discrete so the content is present synchronously on mount (insertion and
    // tests rely on it). Lexical may log a benign "flushSync in a lifecycle"
    // notice when the chips decorator first renders; it does not affect behaviour.
    loadDocument(editor, body);
  }, [editor, body, bodyJsonRef]);
  return null;
}

/**
 * Minimal insert affordances: add a section, and insert a widget into the
 * section at the caret. Insertion is scoped to the §9.3 nesting matrix by only
 * offering section-level widgets here. (Caret-precise nested insertion and a
 * slash menu are tracked as follow-up UX.)
 */
function InsertToolbar() {
  const [editor] = useLexicalComposerContext();

  const addSection = () => {
    editor.update(() => {
      $getRoot().append($createLexicalNode(sectionNode()));
    });
  };

  const insertWidget = (widget: WidgetDescriptor) => {
    editor.update(() => {
      const section = currentSection();
      if (!section) return;
      section.append($createLexicalNode(widget.make()));
    });
  };

  return (
    <div className="pb-toolbar" role="toolbar" aria-label="Insert">
      <button type="button" className="pb-toolbar__btn" onClick={addSection}>
        + Section
      </button>
      <span className="pb-toolbar__sep" aria-hidden="true" />
      {WIDGETS.map((w) => (
        <button
          key={w.kind}
          type="button"
          className="pb-toolbar__btn"
          title={w.description}
          onClick={() => insertWidget(w)}
        >
          + {w.name}
        </button>
      ))}
    </div>
  );
}

/**
 * The section node containing the current selection, or the last section in the
 * document as a fallback (so a widget button works even when focus is outside
 * the editor). Must be called inside an `editor.update`/`read`.
 */
function currentSection(): ElementNode | null {
  const selection = $getSelection();
  if ($isRangeSelection(selection)) {
    let node: LexicalNode | null = selection.anchor.getNode();
    while (node && !$isSectionNode(node)) node = node.getParent();
    if (node) return node as ElementNode;
  }
  const sections = $getRoot()
    .getChildren()
    .filter((n): n is ElementNode => $isSectionNode(n));
  return sections.length ? sections[sections.length - 1] : null;
}

interface SectionHandle {
  key: string;
  top: number;
  first: boolean;
  last: boolean;
}

/**
 * Section reorder controls (F-EDIT-14.3). Sections are `SectionNode`s at the root
 * of the one editor; reordering is moving a node among root's children. Rendered
 * as an overlay rail in the left gutter (outside the contentEditable, so it does
 * not interfere with editing): a move-up / move-down pair plus a drag handle per
 * section. Positions track the live DOM via the editor's update listener.
 */
function SectionControls() {
  const [editor] = useLexicalComposerContext();
  const [handles, setHandles] = useState<SectionHandle[]>([]);
  const dragKey = useRef<string | null>(null);

  useEffect(() => {
    const recompute = () => {
      const root = editor.getRootElement();
      const base = root ? root.getBoundingClientRect().top : 0;
      const next: SectionHandle[] = [];
      // Derive the controls from editor STATE (section nodes + order); the DOM
      // rect only supplies vertical position, so a control still renders before
      // layout (and in jsdom, where rects are 0).
      editor.getEditorState().read(() => {
        const sections = $getRoot()
          .getChildren()
          .filter((n): n is ElementNode => $isSectionNode(n));
        sections.forEach((node, i) => {
          const el = editor.getElementByKey(node.getKey());
          next.push({
            key: node.getKey(),
            top: el ? el.getBoundingClientRect().top - base : 0,
            first: i === 0,
            last: i === sections.length - 1,
          });
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
    };
  }, [editor]);

  const moveSection = (key: string, dir: -1 | 1) =>
    editor.update(() => {
      const node = $getNodeByKey(key);
      if (!$isSectionNode(node)) return;
      if (dir < 0) node.getPreviousSibling()?.insertBefore(node);
      else node.getNextSibling()?.insertAfter(node);
    });

  const dropOn = (targetKey: string) => {
    const sourceKey = dragKey.current;
    dragKey.current = null;
    if (!sourceKey || sourceKey === targetKey) return;
    editor.update(() => {
      const source = $getNodeByKey(sourceKey);
      const target = $getNodeByKey(targetKey);
      if (!$isSectionNode(source) || !$isSectionNode(target)) return;
      if (source.getIndexWithinParent() < target.getIndexWithinParent()) {
        target.insertAfter(source);
      } else {
        target.insertBefore(source);
      }
    });
  };

  if (handles.length === 0) return null;

  return (
    <div className="pb-section-rail" aria-label="Reorder sections">
      {handles.map((h) => (
        <div
          key={h.key}
          className="pb-section-rail__group"
          style={{ top: h.top }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => dropOn(h.key)}
        >
          <button
            type="button"
            className="pb-rail-btn pb-rail-handle"
            aria-label="Drag to reorder section"
            title="Drag to reorder"
            draggable
            onDragStart={() => {
              dragKey.current = h.key;
            }}
            onMouseDown={(e) => e.preventDefault()}
          >
            ⠿
          </button>
          <button
            type="button"
            className="pb-rail-btn"
            aria-label="Move section up"
            disabled={h.first}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => moveSection(h.key, -1)}
          >
            ▲
          </button>
          <button
            type="button"
            className="pb-rail-btn"
            aria-label="Move section down"
            disabled={h.last}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => moveSection(h.key, 1)}
          >
            ▼
          </button>
        </div>
      ))}
    </div>
  );
}

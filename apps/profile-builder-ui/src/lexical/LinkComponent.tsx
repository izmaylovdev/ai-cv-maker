import { LexicalEditor } from 'lexical';
import { useState } from 'react';
import { LinkWidgetNode } from './widget-nodes';

interface LinkComponentProps {
  editor: LexicalEditor;
  nodeKey: string;
  text: string;
  url: string;
}

// React UI for a LinkWidgetNode decorator (spec §10): a standalone link line with
// an editable label and URL. The label shows as a real anchor in its resting
// state and swaps to inputs while editing; every commit goes through
// `editor.update` so the OnChangePlugin round-trips it to the neutral tree.
export function LinkComponent({ editor, nodeKey, text, url }: LinkComponentProps) {
  const [editing, setEditing] = useState(!text && !url);
  const [draftText, setDraftText] = useState(text);
  const [draftUrl, setDraftUrl] = useState(url);

  const commit = () => {
    editor.update(() => {
      const node = editor.getEditorState()._nodeMap.get(nodeKey);
      if (node instanceof LinkWidgetNode) node.setLink(draftText, draftUrl);
    });
    setEditing(false);
  };

  if (editing) {
    return (
      <span className="pb-link__edit" data-pb="link-ui">
        <input
          className="pb-link__text-input"
          aria-label="Link text"
          placeholder="Link text"
          value={draftText}
          onChange={(e) => setDraftText(e.target.value)}
        />
        <input
          className="pb-link__url-input"
          aria-label="Link URL"
          placeholder="https://…"
          value={draftUrl}
          onChange={(e) => setDraftUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
          }}
        />
        <button type="button" className="pb-link__done" onClick={commit}>
          Done
        </button>
      </span>
    );
  }

  return (
    <span className="pb-link__view" data-pb="link-ui">
      <a className="pb-link__anchor" href={safeHref(url)} target="_blank" rel="noopener noreferrer">
        {text || url || 'link'}
      </a>
      <button
        type="button"
        className="pb-link__edit-btn"
        aria-label="Edit link"
        onClick={() => {
          setDraftText(text);
          setDraftUrl(url);
          setEditing(true);
        }}
      >
        Edit
      </button>
    </span>
  );
}

// Only allow http(s)/mailto links to surface as a clickable href; anything else
// (javascript:, data:, etc.) renders inert to avoid an injection vector.
function safeHref(url: string): string | undefined {
  const trimmed = url.trim();
  if (/^(https?:|mailto:)/i.test(trimmed)) return trimmed;
  if (/^[\w.-]+\.[a-z]{2,}/i.test(trimmed)) return `https://${trimmed}`;
  return undefined;
}

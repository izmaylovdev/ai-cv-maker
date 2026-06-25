import { useState } from 'react';
import { LexicalEditor } from 'lexical';
import { Chip, ChipsNode } from './widget-nodes';
import { newId } from '../model';

interface ChipsComponentProps {
  editor: LexicalEditor;
  nodeKey: string;
  chips: Chip[];
}

// React UI for a ChipsNode decorator (spec §9.4): an editable tag cloud. Chip
// data lives on the node; every edit goes through `editor.update` so the change
// is captured by the OnChangePlugin and round-tripped to the neutral tree.
export function ChipsComponent({ editor, nodeKey, chips }: ChipsComponentProps) {
  // Id of the chip whose input should grab focus on the next render — set when a
  // new chip is appended (Enter / + Add) so the caret jumps into it (F-EDIT-13.4).
  const [focusId, setFocusId] = useState<string | null>(null);

  const mutate = (next: Chip[]) => {
    editor.update(() => {
      const node = editor.getEditorState()._nodeMap.get(nodeKey);
      if (node instanceof ChipsNode) node.setChips(next);
    });
  };

  const setText = (id: string, text: string) =>
    mutate(chips.map((c) => (c.id === id ? { ...c, text } : c)));
  const remove = (id: string) => mutate(chips.filter((c) => c.id !== id));

  // Insert a fresh empty chip after `afterId` (or at the end) and queue it for
  // focus so the user can keep typing the next tag without reaching for the mouse.
  const addAfter = (afterId?: string) => {
    const chip: Chip = { id: newId(), text: '' };
    const at = afterId ? chips.findIndex((c) => c.id === afterId) + 1 : chips.length;
    mutate([...chips.slice(0, at), chip, ...chips.slice(at)]);
    setFocusId(chip.id);
  };

  return (
    <>
      {chips.map((chip) => (
        <span key={chip.id} className="pb-chip">
          <ChipInput
            value={chip.text}
            autoFocus={chip.id === focusId}
            onChange={(t) => setText(chip.id, t)}
            onEnter={() => addAfter(chip.id)}
          />
          <button
            type="button"
            className="pb-chip__remove"
            aria-label={`Remove ${chip.text || 'chip'}`}
            onClick={() => remove(chip.id)}
          >
            ✕
          </button>
        </span>
      ))}
      <button type="button" className="pb-chip-add" onClick={() => addAfter()}>
        + Add
      </button>
    </>
  );
}

// An auto-sizing borderless input so a chip hugs its text. `autoFocus` focuses
// the field when it is the freshly added chip; Enter appends a new chip after it.
function ChipInput({
  value,
  autoFocus,
  onChange,
  onEnter,
}: {
  value: string;
  autoFocus?: boolean;
  onChange: (v: string) => void;
  onEnter: () => void;
}) {
  return (
    <span className="pb-chip__field" data-text={value || 'tag'}>
      <input
        className="pb-chip__text"
        value={value}
        placeholder="tag"
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onEnter();
          }
        }}
      />
    </span>
  );
}

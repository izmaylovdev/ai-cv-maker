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
  const mutate = (next: Chip[]) => {
    editor.update(() => {
      const node = editor.getEditorState()._nodeMap.get(nodeKey);
      if (node instanceof ChipsNode) node.setChips(next);
    });
  };

  const setText = (id: string, text: string) =>
    mutate(chips.map((c) => (c.id === id ? { ...c, text } : c)));
  const remove = (id: string) => mutate(chips.filter((c) => c.id !== id));
  const add = () => mutate([...chips, { id: newId(), text: '' }]);

  return (
    <>
      {chips.map((chip) => (
        <span key={chip.id} className="pb-chip">
          <ChipInput value={chip.text} onChange={(t) => setText(chip.id, t)} />
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
      <button type="button" className="pb-chip-add" onClick={add}>
        + Add
      </button>
    </>
  );
}

// An auto-sizing borderless input so a chip hugs its text.
function ChipInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <span className="pb-chip__field" data-text={value || 'tag'}>
      <input
        className="pb-chip__text"
        value={value}
        placeholder="tag"
        onChange={(e) => onChange(e.target.value)}
      />
    </span>
  );
}

import { KeyboardEvent, useLayoutEffect, useRef } from 'react';
import { ChipListSection as ChipListSectionModel, ListItem as ListItemModel } from '../model';
import { newListItem } from '../templates';

interface ChipListSectionProps {
  section: ChipListSectionModel;
  onChange: (section: ChipListSectionModel) => void;
}

const CHIP_PLACEHOLDER = 'Add a skill…';

// A chip/tag list (skills, tools, languages). Same data as a List, rendered as
// compact chips: each chip is an auto-sized input with a × to remove it. Enter
// appends a new chip after the current one; Backspace on an empty chip removes
// it and focuses the previous one (spec §F-EDIT-13).
export function ChipListSection({ section, onChange }: ChipListSectionProps) {
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const pendingFocus = useRef<string | null>(null);

  // After an Enter/Backspace edit re-renders the chips, move focus to the chip
  // the user expects (the new chip, or the previous one after a removal).
  useLayoutEffect(() => {
    const id = pendingFocus.current;
    if (!id) return;
    pendingFocus.current = null;
    const el = inputs.current.get(id);
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  });

  const setItems = (items: ListItemModel[]) => onChange({ ...section, items });

  const updateText = (id: string, text: string) =>
    setItems(section.items.map((it) => (it.id === id ? { ...it, text } : it)));

  const addAfter = (index: number) => {
    const next = newListItem();
    const items = [...section.items];
    items.splice(index + 1, 0, next);
    pendingFocus.current = next.id;
    setItems(items);
  };

  const removeAt = (index: number) => {
    const prev = section.items[index - 1];
    const items = section.items.filter((_, i) => i !== index);
    pendingFocus.current = prev ? prev.id : items[0]?.id ?? null;
    setItems(items);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>, index: number) => {
    const item = section.items[index];

    if (e.key === 'Enter') {
      e.preventDefault();
      addAfter(index);
      return;
    }

    if (e.key === 'Backspace' && item.text.length === 0 && section.items.length > 1) {
      e.preventDefault();
      removeAt(index);
    }
  };

  return (
    <div className="pb-chips">
      {section.items.map((item, index) => (
        <span className="pb-chip" key={item.id}>
          <input
            className="pb-chip__text"
            aria-label="Chip"
            placeholder={CHIP_PLACEHOLDER}
            // Auto-size to content; never below the placeholder width.
            size={Math.max(item.text.length, CHIP_PLACEHOLDER.length) + 1}
            value={item.text}
            ref={(el) => {
              if (el) inputs.current.set(item.id, el);
              else inputs.current.delete(item.id);
            }}
            onChange={(e) => updateText(item.id, e.target.value)}
            onKeyDown={(e) => handleKeyDown(e, index)}
          />
          <button
            type="button"
            className="pb-chip__remove"
            aria-label="Remove chip"
            // Keep at least one chip so the section never becomes uneditable.
            disabled={section.items.length <= 1}
            onClick={() => removeAt(index)}
          >
            ✕
          </button>
        </span>
      ))}
      <button
        type="button"
        className="pb-chip-add"
        aria-label="Add chip"
        onClick={() => addAfter(section.items.length - 1)}
      >
        + Add
      </button>
    </div>
  );
}

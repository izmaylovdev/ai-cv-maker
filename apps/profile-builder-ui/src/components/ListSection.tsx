import { KeyboardEvent, useLayoutEffect, useRef } from 'react';
import { ListSection as ListSectionModel, ListItem as ListItemModel } from '../model';
import { newListItem } from '../templates';

interface ListSectionProps {
  section: ListSectionModel;
  onChange: (section: ListSectionModel) => void;
}

// A bulleted list edited like a document (Word / Google Docs): each bullet is a
// line, Enter starts a new bullet (splitting at the caret), and Backspace at the
// start of a line merges it into the previous one. Arrow Up/Down move between
// lines. No per-item buttons (spec §F-EDIT-11.list).
export function ListSection({ section, onChange }: ListSectionProps) {
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const pendingFocus = useRef<{ id: string; caret: number } | null>(null);

  // After an Enter/Backspace edit re-renders the list, place the caret where the
  // user expects it (the new line, or the merge point on the previous line).
  useLayoutEffect(() => {
    const pf = pendingFocus.current;
    if (!pf) return;
    pendingFocus.current = null;
    const el = inputs.current.get(pf.id);
    if (el) {
      el.focus();
      const caret = Math.min(pf.caret, el.value.length);
      el.setSelectionRange(caret, caret);
    }
  });

  const setItems = (items: ListItemModel[]) => onChange({ ...section, items });

  const updateText = (id: string, text: string) =>
    setItems(section.items.map((it) => (it.id === id ? { ...it, text } : it)));

  const focusAt = (id: string, caret: number) => {
    const el = inputs.current.get(id);
    if (!el) return;
    el.focus();
    const c = Math.min(caret, el.value.length);
    el.setSelectionRange(c, c);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>, index: number) => {
    const input = e.currentTarget;
    const item = section.items[index];
    const caret = input.selectionStart ?? input.value.length;
    const caretEnd = input.selectionEnd ?? caret;
    const atStart = caret === 0 && caretEnd === 0;

    if (e.key === 'Enter') {
      e.preventDefault();
      const next = newListItem();
      next.text = item.text.slice(caretEnd);
      const items = section.items.map((it) =>
        it.id === item.id ? { ...it, text: item.text.slice(0, caret) } : it
      );
      items.splice(index + 1, 0, next);
      pendingFocus.current = { id: next.id, caret: 0 };
      setItems(items);
      return;
    }

    if (e.key === 'Backspace' && atStart && index > 0) {
      e.preventDefault();
      const prev = section.items[index - 1];
      const prevLen = prev.text.length;
      const items = section.items
        .map((it) => (it.id === prev.id ? { ...it, text: prev.text + item.text } : it))
        .filter((it) => it.id !== item.id);
      pendingFocus.current = { id: prev.id, caret: prevLen };
      setItems(items);
      return;
    }

    if (e.key === 'ArrowUp' && index > 0) {
      e.preventDefault();
      focusAt(section.items[index - 1].id, caret);
      return;
    }

    if (e.key === 'ArrowDown' && index < section.items.length - 1) {
      e.preventDefault();
      focusAt(section.items[index + 1].id, caret);
    }
  };

  return (
    <ul className="pb-list">
      {section.items.map((item, index) => (
        <li className="pb-list__item" key={item.id}>
          <span className="pb-list__bullet" aria-hidden="true">
            •
          </span>
          <input
            className="pb-list__text"
            aria-label="List item"
            placeholder="List item"
            value={item.text}
            ref={(el) => {
              if (el) inputs.current.set(item.id, el);
              else inputs.current.delete(item.id);
            }}
            onChange={(e) => updateText(item.id, e.target.value)}
            onKeyDown={(e) => handleKeyDown(e, index)}
          />
        </li>
      ))}
    </ul>
  );
}

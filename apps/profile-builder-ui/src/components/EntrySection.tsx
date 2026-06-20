import { EntrySection as EntrySectionModel, EntryItem as EntryItemModel } from '../model';
import { newEntryItem } from '../templates';
import { reorder } from '../util';
import { EntryItem, EntryPlaceholders } from './EntryItem';

interface EntrySectionProps {
  section: EntrySectionModel;
  placeholders: EntryPlaceholders;
  addLabel: string;
  onChange: (section: EntrySectionModel) => void;
}

// A section of dated entries (Work Experience / Education): an ordered list of
// items the user can add, edit, reorder, and remove (spec §F-EDIT-10, §F-EDIT-12.3).
export function EntrySection({ section, placeholders, addLabel, onChange }: EntrySectionProps) {
  const setItems = (items: EntryItemModel[]) => onChange({ ...section, items });

  const updateItem = (id: string, next: EntryItemModel) =>
    setItems(section.items.map((it) => (it.id === id ? next : it)));

  const removeItem = (id: string) =>
    setItems(section.items.filter((it) => it.id !== id));

  const moveItem = (index: number, dir: -1 | 1) =>
    setItems(reorder(section.items, index, index + dir));

  const addItem = () => setItems([...section.items, newEntryItem()]);

  return (
    <div className="pb-workexp">
      {section.items.map((item, index) => (
        <EntryItem
          key={item.id}
          item={item}
          placeholders={placeholders}
          isFirst={index === 0}
          isLast={index === section.items.length - 1}
          onChange={(next) => updateItem(item.id, next)}
          onRemove={() => removeItem(item.id)}
          onMoveUp={() => moveItem(index, -1)}
          onMoveDown={() => moveItem(index, 1)}
        />
      ))}

      <button type="button" className="pb-workexp__add" aria-label="Add item" onClick={addItem}>
        {addLabel}
      </button>
    </div>
  );
}

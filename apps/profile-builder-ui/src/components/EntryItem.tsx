import { EntryItem as EntryItemModel } from '../model';
import { AutoTextarea } from './AutoTextarea';

export interface EntryPlaceholders {
  title: string;
  dates: string;
  description: string;
}

interface EntryItemProps {
  item: EntryItemModel;
  placeholders: EntryPlaceholders;
  isFirst: boolean;
  isLast: boolean;
  onChange: (item: EntryItemModel) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

// A single dated entry (Work Experience or Education) laid out like a résumé
// line — bold title with the date range alongside it and the description as a
// paragraph below — rather than a stack of labelled form fields (spec §F-EDIT-10).
export function EntryItem({
  item,
  placeholders,
  isFirst,
  isLast,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
}: EntryItemProps) {
  const set = (patch: Partial<EntryItemModel>) => onChange({ ...item, ...patch });

  return (
    <div className="pb-item">
      <div className="pb-item__row">
        <input
          className="pb-item__title"
          aria-label="Title"
          placeholder={placeholders.title}
          value={item.title}
          onChange={(e) => set({ title: e.target.value })}
        />

        <input
          className="pb-item__dates"
          aria-label="Dates"
          placeholder={placeholders.dates}
          value={item.dates}
          onChange={(e) => set({ dates: e.target.value })}
        />
      </div>

      <AutoTextarea
        className="pb-item__desc"
        aria-label="Description"
        placeholder={placeholders.description}
        value={item.description}
        onChange={(e) => set({ description: e.target.value })}
      />

      <div className="pb-item__tools">
        <button type="button" aria-label="Move item up" disabled={isFirst} onClick={onMoveUp}>
          ↑
        </button>
        <button type="button" aria-label="Move item down" disabled={isLast} onClick={onMoveDown}>
          ↓
        </button>
        <button type="button" className="pb-tool-danger" aria-label="Remove item" onClick={onRemove}>
          ✕
        </button>
      </div>
    </div>
  );
}

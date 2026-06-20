import { useState } from 'react';
import { SectionTemplate } from '../model';

interface AddSectionPaletteProps {
  templates: SectionTemplate[];
  onSelect: (template: SectionTemplate) => void;
  /** Label for the trigger — varies between empty-state and inline use. */
  triggerLabel?: string;
}

// "Add section" trigger + popover palette listing templates with a name and a
// one-line description (spec §F-EDIT-9.1, §F-EDIT-9.3).
export function AddSectionPalette({
  templates,
  onSelect,
  triggerLabel = 'Add section',
}: AddSectionPaletteProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="pb-palette">
      <button
        type="button"
        className="pb-palette__trigger"
        aria-label="Add section"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        + {triggerLabel}
      </button>

      {open && (
        <ul className="pb-palette__menu">
          {templates.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                className="pb-palette__item"
                aria-label={`Add ${t.name}`}
                onClick={() => {
                  onSelect(t);
                  setOpen(false);
                }}
              >
                <span className="pb-palette__name">{t.name}</span>
                <span className="pb-palette__desc">{t.description}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

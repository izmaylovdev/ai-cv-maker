import { FreeFormSection as FreeFormSectionModel } from '../model';
import { AutoTextarea } from './AutoTextarea';

interface FreeFormSectionProps {
  section: FreeFormSectionModel;
  onChange: (section: FreeFormSectionModel) => void;
}

// General-purpose section: editable heading (in the frame) + free-form body
// rendered as flowing document text (spec §F-EDIT-11).
export function FreeFormSection({ section, onChange }: FreeFormSectionProps) {
  return (
    <AutoTextarea
      className="pb-freeform__body"
      aria-label="Section body"
      placeholder="Write anything here…"
      value={section.body}
      onChange={(e) => onChange({ ...section, body: e.target.value })}
    />
  );
}

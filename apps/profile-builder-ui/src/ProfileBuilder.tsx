import { useRef, useState } from 'react';
import './ProfileBuilder.css';
import {
  DocumentSection,
  ProfileDocument,
  SectionTemplate,
  FreeFormSection as FreeFormSectionModel,
  EntrySection as EntrySectionModel,
  ListSection as ListSectionModel,
} from './model';
import { DEFAULT_SECTION_TEMPLATES } from './templates';
import { reorder, sectionHasContent } from './util';
import { SectionFrame } from './components/SectionFrame';
import { FreeFormSection } from './components/FreeFormSection';
import { EntrySection } from './components/EntrySection';
import { EntryPlaceholders } from './components/EntryItem';
import { ListSection } from './components/ListSection';
import { AddSectionPalette } from './components/AddSectionPalette';

const ENTRY_PLACEHOLDERS: EntryPlaceholders = {
  title: 'Title — role, degree, or project',
  dates: 'Jan 2022 – Present',
  description: 'What you did and the highlights…',
};
const ENTRY_ADD_LABEL = '+ Add entry';

export interface ProfileBuilderProps {
  /** Initial document the builder is seeded with. */
  document: ProfileDocument;
  /** Called with the full document on every edit. */
  onChange?: (document: ProfileDocument) => void;
  /** Override the default template registry (defaults applied when absent). */
  templates?: SectionTemplate[];
}

// Root of the document builder (spec §7.3). Holds the document in local state,
// edits it in place, and emits the whole document on every change. Host-agnostic:
// no fetch, auth, or routing here.
export function ProfileBuilder({
  document,
  onChange,
  templates = DEFAULT_SECTION_TEMPLATES,
}: ProfileBuilderProps) {
  const [doc, setDoc] = useState<ProfileDocument>(document);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  // Re-seed when the host supplies a new document (e.g. the web component's
  // `document` property/attribute is set after the element upgrades). Local
  // edits don't change the `document` prop, so they are preserved.
  const seededRef = useRef(document);
  if (document !== seededRef.current) {
    seededRef.current = document;
    setDoc(document);
  }

  const commit = (next: ProfileDocument) => {
    setDoc(next);
    onChange?.(next);
  };

  const setSections = (sections: DocumentSection[]) => commit({ ...doc, sections });

  const updateSection = (id: string, next: DocumentSection) =>
    setSections(doc.sections.map((s) => (s.id === id ? next : s)));

  const removeSection = (id: string) =>
    setSections(doc.sections.filter((s) => s.id !== id));

  const moveSection = (index: number, dir: -1 | 1) =>
    setSections(reorder(doc.sections, index, index + dir));

  const insertSection = (template: SectionTemplate, atIndex: number) => {
    const next = [...doc.sections];
    next.splice(atIndex, 0, template.create());
    setSections(next);
  };

  const onDrop = (targetIndex: number) => {
    if (dragIndex === null) return;
    setSections(reorder(doc.sections, dragIndex, targetIndex));
    setDragIndex(null);
  };

  if (doc.sections.length === 0) {
    return (
      <div className="pb-root pb-root--empty">
        <div className="pb-empty">
          <h2 className="pb-empty__title">Add your first section</h2>
          <p className="pb-empty__hint">
            Build your profile as a document. Start with a Work Experience section
            or a blank one and add more as you go.
          </p>
          <AddSectionPalette
            templates={templates}
            triggerLabel="Add section"
            onSelect={(t) => insertSection(t, doc.sections.length)}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="pb-root">
      {doc.sections.map((section, index) => (
        <div
          key={section.id}
          className="pb-section-wrap"
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => onDrop(index)}
        >
          <SectionFrame
            heading={section.heading}
            hasContent={sectionHasContent(section)}
            isFirst={index === 0}
            isLast={index === doc.sections.length - 1}
            onHeadingChange={(heading) => updateSection(section.id, { ...section, heading })}
            onMoveUp={() => moveSection(index, -1)}
            onMoveDown={() => moveSection(index, 1)}
            onRemove={() => removeSection(section.id)}
            dragHandleProps={{
              draggable: true,
              onDragStart: () => setDragIndex(index),
              onDragEnd: () => setDragIndex(null),
            }}
          >
            {section.template === 'timeline' ? (
              <EntrySection
                section={section as EntrySectionModel}
                placeholders={ENTRY_PLACEHOLDERS}
                addLabel={ENTRY_ADD_LABEL}
                onChange={(next) => updateSection(section.id, next)}
              />
            ) : section.template === 'list' ? (
              <ListSection
                section={section as ListSectionModel}
                onChange={(next) => updateSection(section.id, next)}
              />
            ) : (
              <FreeFormSection
                section={section as FreeFormSectionModel}
                onChange={(next) => updateSection(section.id, next)}
              />
            )}
          </SectionFrame>
        </div>
      ))}

      <div className="pb-add-more">
        <AddSectionPalette
          templates={templates}
          triggerLabel="Add section"
          onSelect={(t) => insertSection(t, doc.sections.length)}
        />
      </div>
    </div>
  );
}

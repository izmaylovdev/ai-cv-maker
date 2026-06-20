// In-memory document model for the profile builder (UX phase, spec §7.2).
// Plain, JSON-safe shapes — deliberately NOT the persisted `Profile` shape.

export type SectionTemplateId = 'free-form' | 'timeline' | 'list';

export interface ProfileDocument {
  sections: DocumentSection[];
}

export type DocumentSection =
  | FreeFormSection
  | EntrySection
  | ListSection;

export interface SectionBase {
  /** Client-generated stable id. */
  id: string;
  template: SectionTemplateId;
  heading: string;
}

export interface FreeFormSection extends SectionBase {
  template: 'free-form';
  body: string;
}

/**
 * A "Timeline": a section of dated entries. One generic section type that suits
 * work experience, education, projects, etc. — each entry has a title, a
 * free-text date range, and a description. The user names it via the heading.
 */
export interface EntrySection extends SectionBase {
  template: 'timeline';
  items: EntryItem[];
}

export interface EntryItem {
  id: string;
  title: string;
  /** Free-text date range, e.g. "Jan 2022 – Present". */
  dates: string;
  description: string;
}

/** A simple bulleted list — skills, tools, or any short items. */
export interface ListSection extends SectionBase {
  template: 'list';
  items: ListItem[];
}

export interface ListItem {
  id: string;
  text: string;
}

/** Describes a template shown in the "Add section" palette (spec §7.2). */
export interface SectionTemplate {
  id: SectionTemplateId;
  /** Shown in the palette. */
  name: string;
  /** One-line purpose, shown in the palette. */
  description: string;
  /** Returns a seeded section with a fresh id. */
  create(): DocumentSection;
}

/** Collision-resistant id generator with a fallback for non-secure contexts. */
export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function emptyDocument(): ProfileDocument {
  return { sections: [] };
}

// Canonical profile document model (ADR-0013). Plain, JSON-safe shapes; this is
// the persisted `Profile.Document` shape end to end — cv-api stores it as a JSON
// column, the gRPC proto (ProfileDocumentProto) and llm-service mirror it, and
// the PDF renders it. This TypeScript definition is the reference; keep the C#
// CvApi.Domain.Entities.ProfileDocument and Python app/schemas.py in sync.

export type SectionTemplateId = 'free-form' | 'timeline' | 'list' | 'chip-list';

export interface ProfileDocument {
  /** Fixed identity/contact letterhead, always present above the sections. */
  header: ProfileHeader;
  sections: DocumentSection[];
}

/**
 * The document's letterhead: identity and contact details. Unlike sections,
 * this block is fixed (not addable/removable/reorderable) — every CV needs it,
 * and the persisted `Profile` and PDF renderer depend on these fields.
 */
export interface ProfileHeader {
  fullName: string;
  /** Professional headline / job title, e.g. "Senior Software Engineer". */
  title: string;
  email: string;
  phone: string;
  location: string;
}

export type DocumentSection =
  | FreeFormSection
  | EntrySection
  | ListSection
  | ChipListSection;

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

/**
 * A chip/tag list — the same short text items as a List, but rendered as compact
 * chips (a tag cloud) instead of bullets. Suits skills, tools, languages, etc.
 * Reuses ListItem; the `template` discriminant drives the chip rendering.
 */
export interface ChipListSection extends SectionBase {
  template: 'chip-list';
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

export function emptyHeader(): ProfileHeader {
  return { fullName: '', title: '', email: '', phone: '', location: '' };
}

export function emptyDocument(): ProfileDocument {
  return { header: emptyHeader(), sections: [] };
}

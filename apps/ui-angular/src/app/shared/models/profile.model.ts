// Canonical section-based profile model (ADR-0013). Mirrors the builder's
// reference shape in apps/profile-builder-ui/src/model.ts — the API speaks
// `{ id, name, document }` where `document` is this `ProfileDocument`.

export type SectionTemplateId = 'free-form' | 'timeline' | 'list' | 'chip-list';

export interface ProfileDocument {
  /** Fixed identity/contact letterhead, always present above the sections. */
  header: ProfileHeader;
  sections: DocumentSection[];
}

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

export interface ListSection extends SectionBase {
  template: 'list';
  items: ListItem[];
}

/** Like a List, but rendered as chips/tags (skills, tools, languages). */
export interface ChipListSection extends SectionBase {
  template: 'chip-list';
  items: ListItem[];
}

export interface ListItem {
  id: string;
  text: string;
}

export function emptyHeader(): ProfileHeader {
  return { fullName: '', title: '', email: '', phone: '', location: '' };
}

export function emptyDocument(): ProfileDocument {
  return { header: emptyHeader(), sections: [] };
}

/** The profile envelope returned by GET/PUT /api/job-profiles/:id. */
export interface JobProfile {
  id: string;
  name: string;
  document: ProfileDocument;
}

export interface JobProfileListItem {
  id: string;
  name: string;
  fullName: string;
  title: string;
}

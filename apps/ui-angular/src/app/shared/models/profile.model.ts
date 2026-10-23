// Canonical block-tree profile model (ADR-0014). Mirrors the builder's
// reference shape in apps/profile-builder-ui/src/model.ts — the API speaks
// `{ id, name, document }` where `document` is this `ProfileDocument`.

export type NodeType =
  | 'root'
  | 'title'
  | 'paragraph'
  | 'text'
  | 'list'
  | 'listItem'
  | 'chips'
  | 'chip'
  | 'timeline'
  | 'entry';

export interface BlockNode {
  type: NodeType;
  id: string;
  attrs?: Record<string, string>;
  children?: BlockNode[];
}

export interface ProfileHeader {
  fullName: string;
  /** Professional headline / job title, e.g. "Senior Software Engineer". */
  title: string;
  email: string;
  phone: string;
  location: string;
}

export interface ProfileDocument {
  header: ProfileHeader;
  body: BlockNode;
}

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

export function emptyHeader(): ProfileHeader {
  return { fullName: '', title: '', email: '', phone: '', location: '' };
}

export function emptyDocument(): ProfileDocument {
  return {
    header: emptyHeader(),
    body: { type: 'root', id: '', children: [] },
  };
}

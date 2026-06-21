import {
  DocumentSection,
  newId,
  SectionTemplate,
} from './model';

// Default template registry (spec §7.3). Hosts can supply additional templates
// via the registry prop without changing the widget.

const freeFormTemplate: SectionTemplate = {
  id: 'free-form',
  name: 'General section',
  description: 'A blank section with a heading and free-form text.',
  create: (): DocumentSection => ({
    id: newId(),
    template: 'free-form',
    heading: 'Section heading',
    body: '',
  }),
};

const timelineTemplate: SectionTemplate = {
  id: 'timeline',
  name: 'Timeline',
  description: 'Dated entries — work experience, education, projects. Each has a title, dates, and a description.',
  create: (): DocumentSection => ({
    id: newId(),
    template: 'timeline',
    heading: 'Experience',
    items: [newEntryItem()],
  }),
};

const listTemplate: SectionTemplate = {
  id: 'list',
  name: 'List',
  description: 'A simple bulleted list — skills, tools, or anything else.',
  create: (): DocumentSection => ({
    id: newId(),
    template: 'list',
    heading: 'Skills',
    items: [newListItem()],
  }),
};

const chipListTemplate: SectionTemplate = {
  id: 'chip-list',
  name: 'Chip list',
  description: 'Short items shown as chips/tags — skills, tools, languages.',
  create: (): DocumentSection => ({
    id: newId(),
    template: 'chip-list',
    heading: 'Skills',
    items: [newListItem()],
  }),
};

export function newEntryItem() {
  return {
    id: newId(),
    title: '',
    dates: '',
    description: '',
  };
}

export function newListItem() {
  return {
    id: newId(),
    text: '',
  };
}

export const DEFAULT_SECTION_TEMPLATES: SectionTemplate[] = [
  freeFormTemplate,
  timelineTemplate,
  listTemplate,
  chipListTemplate,
];

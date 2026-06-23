import { ProfileDocument } from './model';
import {
  chipsNode,
  entryNode,
  listNode,
  paragraphNode,
  rootNode,
  timelineNode,
  titleNode,
} from './nodes';

// Seed document for the standalone dev harness only (not shipped as behaviour).
// Demonstrates the flat title-anchored body (ADR-0014 §13 / US-EDIT-19):
// title nodes anchor groups of flow widgets (text, timeline, list, chips).
export const SAMPLE_DOCUMENT: ProfileDocument = {
  header: {
    fullName: 'Ada Lovelace',
    title: 'Senior Software Engineer',
    email: 'ada@example.com',
    phone: '+1 (555) 010-1842',
    location: 'London, UK',
  },
  body: rootNode([
    titleNode('Summary'),
    paragraphNode('Product-minded engineer with 8 years building web apps end to end.'),

    titleNode('Work Experience'),
    timelineNode([
      entryNode(
        'Senior Engineer · Acme Inc.',
        'Jan 2022 – Present',
        'Lead the web platform team; shipped the new editor.',
      ),
      entryNode(
        'Engineer · Globex',
        'Jun 2018 – Dec 2021',
        'Built internal tooling and the public API.',
      ),
    ]),

    titleNode('Education'),
    timelineNode([
      entryNode('BSc Computer Science · MIT', '2014 – 2018', 'Graduated with honors.'),
    ]),

    titleNode('Skills'),
    listNode(['TypeScript', 'React', 'Node.js']),

    titleNode('Tools & Languages'),
    chipsNode(['Docker', 'PostgreSQL', 'Python', 'GraphQL', 'AWS']),
  ]),
};

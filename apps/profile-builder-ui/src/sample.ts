import { FlowNode, ProfileDocument, SectionNode } from './model';
import {
  chipsNode,
  entryNode,
  listNode,
  paragraphNode,
  rootNode,
  sectionNode,
  timelineNode,
} from './nodes';

// Seed document for the standalone dev harness only (not shipped as behaviour).
// Demonstrates the block-tree body (ADR-0014 §9.2): sections containing mixed
// widgets — text, timeline, list, chips.
function section(heading: string, ...children: FlowNode[]): SectionNode {
  return { ...sectionNode(heading), children };
}

export const SAMPLE_DOCUMENT: ProfileDocument = {
  header: {
    fullName: 'Ada Lovelace',
    title: 'Senior Software Engineer',
    email: 'ada@example.com',
    phone: '+1 (555) 010-1842',
    location: 'London, UK',
  },
  body: rootNode([
    section(
      'Summary',
      paragraphNode('Product-minded engineer with 8 years building web apps end to end.'),
    ),
    section(
      'Work Experience',
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
    ),
    section(
      'Education',
      timelineNode([
        entryNode('BSc Computer Science · MIT', '2014 – 2018', 'Graduated with honors.'),
      ]),
    ),
    section('Skills', listNode(['TypeScript', 'React', 'Node.js'])),
    section('Tools & Languages', chipsNode(['Docker', 'PostgreSQL', 'Python', 'GraphQL', 'AWS'])),
  ]),
};

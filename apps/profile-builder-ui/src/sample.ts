import { ProfileDocument } from './model';

// Seed document for the standalone dev harness only (not shipped as behaviour).
export const SAMPLE_DOCUMENT: ProfileDocument = {
  header: {
    fullName: 'Ada Lovelace',
    title: 'Senior Software Engineer',
    email: 'ada@example.com',
    phone: '+1 (555) 010-1842',
    location: 'London, UK',
  },
  sections: [
    {
      id: 'sample-summary',
      template: 'free-form',
      heading: 'Summary',
      body: 'Product-minded engineer with 8 years building web apps end to end.',
    },
    {
      id: 'sample-work',
      template: 'timeline',
      heading: 'Work Experience',
      items: [
        {
          id: 'sample-work-1',
          title: 'Senior Engineer · Acme Inc.',
          dates: 'Jan 2022 – Present',
          description: 'Lead the web platform team; shipped the new editor.',
        },
        {
          id: 'sample-work-2',
          title: 'Engineer · Globex',
          dates: 'Jun 2018 – Dec 2021',
          description: 'Built internal tooling and the public API.',
        },
      ],
    },
    {
      id: 'sample-education',
      template: 'timeline',
      heading: 'Education',
      items: [
        {
          id: 'sample-edu-1',
          title: 'BSc Computer Science · MIT',
          dates: '2014 – 2018',
          description: 'Graduated with honors.',
        },
      ],
    },
    {
      id: 'sample-skills',
      template: 'list',
      heading: 'Skills',
      items: [
        { id: 'sample-skill-1', text: 'TypeScript' },
        { id: 'sample-skill-2', text: 'React' },
        { id: 'sample-skill-3', text: 'Node.js' },
      ],
    },
    {
      id: 'sample-tools',
      template: 'chip-list',
      heading: 'Tools & Languages',
      items: [
        { id: 'sample-tool-1', text: 'Docker' },
        { id: 'sample-tool-2', text: 'PostgreSQL' },
        { id: 'sample-tool-3', text: 'Python' },
        { id: 'sample-tool-4', text: 'GraphQL' },
        { id: 'sample-tool-5', text: 'AWS' },
      ],
    },
  ],
};

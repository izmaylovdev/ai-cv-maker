import { ProfileDocument } from './model';

// Seed document for the standalone dev harness only (not shipped as behaviour).
export const SAMPLE_DOCUMENT: ProfileDocument = {
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
  ],
};

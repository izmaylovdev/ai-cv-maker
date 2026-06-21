import { TEST_PROFILE_ID } from '../constants';

// Canonical section-based profile (ADR-0013): GET/PUT /job-profiles/:id speak
// `{ id, name, document }` where `document` is a ProfileDocument.
export const mockDocument = {
  header: {
    fullName: 'Jane Doe',
    title: 'Software Engineer',
    email: 'jane@example.com',
    phone: '+49 123 456789',
    location: 'Berlin, Germany',
  },
  sections: [
    {
      id: 'sec-summary',
      template: 'free-form' as const,
      heading: 'Summary',
      body: 'Experienced engineer with 8 years building scalable systems.',
    },
    {
      id: 'sec-experience',
      template: 'timeline' as const,
      heading: 'Experience',
      items: [
        {
          id: 'exp-1',
          title: 'Lead Engineer · Acme Corp',
          dates: 'Jan 2020 – Jun 2023',
          description: 'Led a team of 5 engineers.',
        },
      ],
    },
    {
      id: 'sec-skills',
      template: 'list' as const,
      heading: 'Skills',
      items: [
        { id: 'sk-1', text: 'TypeScript' },
        { id: 'sk-2', text: 'Go' },
      ],
    },
  ],
};

export const mockProfile = {
  id: TEST_PROFILE_ID,
  name: 'Senior Backend Engineer',
  document: mockDocument,
};

// An AI-optimized document returned by the optimize endpoint.
export const mockOptimizedDocument = {
  header: { ...mockDocument.header, title: 'Senior TypeScript Engineer' },
  sections: [
    {
      id: 'sec-summary',
      template: 'free-form' as const,
      heading: 'Summary',
      body: 'Optimized overview targeting fintech.',
    },
  ],
};

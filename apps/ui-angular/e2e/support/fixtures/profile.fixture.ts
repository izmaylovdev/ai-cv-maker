import { TEST_PROFILE_ID } from '../constants';

export const mockProfile = {
  id: TEST_PROFILE_ID,
  name: 'Senior Backend Engineer',
  fullName: 'Jane Doe',
  title: 'Software Engineer',
  overview: 'Experienced engineer with 8 years building scalable systems.',
  location: 'Berlin, Germany',
  contacts: { email: 'jane@example.com', phone: '+49 123 456789' },
  workExperiences: [
    {
      company: 'Acme Corp',
      role: 'Lead Engineer',
      startDate: '2020-01',
      endDate: '2023-06',
      description: 'Led a team of 5 engineers.',
    },
  ],
  educations: [
    {
      institution: 'TU Berlin',
      degree: 'MSc',
      field: 'Computer Science',
      startYear: 2015,
      endYear: 2017,
    },
  ],
  skills: [{ name: 'TypeScript' }, { name: 'Go' }],
  sectionOrder: ['workExperiences', 'educations', 'skills'],
};

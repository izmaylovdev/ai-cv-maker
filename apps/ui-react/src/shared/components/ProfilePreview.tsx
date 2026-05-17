import { Link } from 'react-router-dom';

import type { Profile } from '../models/profile.model';

type Props = {
  profile: Profile | null;
  loading?: boolean;
};

export function ProfilePreview({ profile, loading }: Props) {
  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <span className="h-7 w-7 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600 dark:border-blue-900" />
      </div>
    );
  }

  if (profile) {
    return (
      <div className="p-8">
        <div className="mx-auto max-w-2xl">
          <div className="mb-5 border-b-2 border-gray-200 pb-5 dark:border-gray-600">
            <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
              {profile.fullName}
            </h1>
            <p className="mt-1 text-base font-medium text-indigo-600 dark:text-indigo-400">
              {profile.title}
            </p>
            {profile.location ? (
              <p className="mt-1 flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                <span className="material-icons text-[14px]">place</span>
                {profile.location}
              </p>
            ) : null}
            {(profile.contacts?.email || profile.contacts?.phone) && (
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                {profile.contacts?.email && (
                  <span className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                    <span className="material-icons text-[14px]">email</span>
                    {profile.contacts.email}
                  </span>
                )}
                {profile.contacts?.phone && (
                  <span className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                    <span className="material-icons text-[14px]">phone</span>
                    {profile.contacts.phone}
                  </span>
                )}
              </div>
            )}
          </div>

          {profile.overview && (
            <section className="mb-6">
              <h2 className="mb-2 text-[10px] font-bold uppercase tracking-[0.15em] text-gray-400 dark:text-gray-500">
                Summary
              </h2>
              <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-300">
                {profile.overview}
              </p>
            </section>
          )}

          {!!profile.workExperiences?.length && (
            <section className="mb-6">
              <h2 className="mb-3 text-[10px] font-bold uppercase tracking-[0.15em] text-gray-400 dark:text-gray-500">
                Experience
              </h2>
              <div className="space-y-4">
                {profile.workExperiences.map((job, i) => (
                  <div key={i}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-bold text-gray-900 dark:text-white">
                          {job.role}
                        </h3>
                        <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
                          {job.company}
                        </p>
                      </div>
                      <span className="whitespace-nowrap pt-0.5 text-xs text-gray-400 dark:text-gray-500">
                        {job.startDate} – {job.endDate || 'Present'}
                      </span>
                    </div>
                    {job.description && (
                      <p className="mt-2 text-xs leading-relaxed text-gray-600 dark:text-gray-400">
                        {job.description}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {!!profile.educations?.length && (
            <section className="mb-6">
              <h2 className="mb-3 text-[10px] font-bold uppercase tracking-[0.15em] text-gray-400 dark:text-gray-500">
                Education
              </h2>
              <div className="space-y-3">
                {profile.educations.map((edu, i) => (
                  <div key={i} className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-bold text-gray-900 dark:text-white">
                        {edu.degree}
                        {edu.field ? ` in ${edu.field}` : ''}
                      </h3>
                      <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
                        {edu.institution}
                      </p>
                    </div>
                    <span className="whitespace-nowrap pt-0.5 text-xs text-gray-400 dark:text-gray-500">
                      {edu.startYear} – {edu.endYear ?? 'Present'}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {!!profile.skills?.length && (
            <section>
              <h2 className="mb-3 text-[10px] font-bold uppercase tracking-[0.15em] text-gray-400 dark:text-gray-500">
                Skills
              </h2>
              <div className="flex flex-wrap gap-2">
                {profile.skills.map((skill, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center rounded-full border border-gray-200 bg-gray-100 px-3 py-1 text-xs text-gray-700 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300"
                  >
                    {skill.name}
                  </span>
                ))}
              </div>
            </section>
          )}

          {!profile.overview &&
            !profile.location &&
            !profile.workExperiences?.length &&
            !profile.educations?.length &&
            !profile.skills?.length && (
              <div className="flex flex-col items-center py-16 text-center">
                <span className="material-icons text-5xl text-gray-200 dark:text-gray-700">
                  description
                </span>
                <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
                  Your profile is empty.
                </p>
                <Link
                  to="/profile"
                  className="mt-1 text-sm text-blue-600 hover:underline dark:text-blue-400"
                >
                  Fill in your profile →
                </Link>
              </div>
            )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center px-4 py-16 text-center">
      <span className="material-icons text-5xl text-gray-200 dark:text-gray-700">
        person_off
      </span>
      <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
        Could not load profile.
      </p>
      <Link
        to="/profile"
        className="mt-1 text-sm text-blue-600 hover:underline dark:text-blue-400"
      >
        Go to Profile →
      </Link>
    </div>
  );
}

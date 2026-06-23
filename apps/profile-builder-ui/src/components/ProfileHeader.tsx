import { ProfileHeader as ProfileHeaderModel } from '../model';

interface ProfileHeaderProps {
  header: ProfileHeaderModel;
  onChange: (header: ProfileHeaderModel) => void;
}

// The document's letterhead: name, headline, and contact line. Edited in place
// like the rest of the sheet (borderless inputs), but fixed — it can't be
// removed or reordered. Carries the identity/contact fields the persisted
// Profile and the PDF renderer require.
export function ProfileHeader({ header, onChange }: ProfileHeaderProps) {
  const set = (patch: Partial<ProfileHeaderModel>) => onChange({ ...header, ...patch });

  return (
    <header className="pb-header">
      <div className="pb-header__identity">
        <input
          className="pb-header__name"
          aria-label="Full name"
          placeholder="Your name"
          value={header.fullName}
          onChange={(e) => set({ fullName: e.target.value })}
        />
        <input
          className="pb-header__title"
          aria-label="Job title"
          placeholder="Professional headline — e.g. Senior Software Engineer"
          value={header.title}
          onChange={(e) => set({ title: e.target.value })}
        />
        <input
          className="pb-header__contact pb-header__location"
          aria-label="Location"
          placeholder="Location"
          value={header.location}
          onChange={(e) => set({ location: e.target.value })}
        />
      </div>
      <div className="pb-header__contacts">
        <input
          className="pb-header__contact"
          type="email"
          aria-label="Email"
          placeholder="email@example.com"
          value={header.email}
          onChange={(e) => set({ email: e.target.value })}
        />
        <input
          className="pb-header__contact"
          type="tel"
          aria-label="Phone"
          placeholder="Phone"
          value={header.phone}
          onChange={(e) => set({ phone: e.target.value })}
        />
      </div>
    </header>
  );
}

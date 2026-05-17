import { environment } from '../environments/environment';
import type { Profile } from '../shared/models/profile.model';

const PROFILE_URL = `${environment.apiUrl}/profile`;

export type ProfileUpdatePayload = Omit<Profile, 'id'>;

export async function getProfile(token: string): Promise<Profile> {
  const res = await fetch(PROFILE_URL, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw res;
  return res.json() as Promise<Profile>;
}

export async function updateProfile(
  token: string,
  body: ProfileUpdatePayload,
): Promise<Profile> {
  const res = await fetch(PROFILE_URL, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw res;
  return res.json() as Promise<Profile>;
}

export type OptimizeWorkExperience = {
  company: string;
  role: string;
  startDate: string;
  endDate?: string;
  description: string;
};

export type OptimizeSkill = { name: string };

export type OptimizeProfileResponse = {
  title: string;
  overview: string;
  workExperiences: OptimizeWorkExperience[];
  skills: OptimizeSkill[];
};

export async function optimizeProfile(
  token: string,
  message: string,
): Promise<OptimizeProfileResponse> {
  const res = await fetch(`${PROFILE_URL}/optimize`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) throw res;
  return res.json() as Promise<OptimizeProfileResponse>;
}

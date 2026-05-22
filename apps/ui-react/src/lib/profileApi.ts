import { environment } from '../environments/environment';
import type { JobProfileListItem, Profile } from '../shared/models/profile.model';

const BASE = `${environment.apiUrl}/job-profiles`;

export type ProfileUpdatePayload = Omit<Profile, 'id'>;

export async function listProfiles(token: string): Promise<JobProfileListItem[]> {
  const res = await fetch(BASE, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw res;
  return res.json() as Promise<JobProfileListItem[]>;
}

export async function createProfile(token: string, name: string): Promise<JobProfileListItem> {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw res;
  return res.json() as Promise<JobProfileListItem>;
}

export async function getProfile(token: string, id: string): Promise<Profile> {
  const res = await fetch(`${BASE}/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw res;
  return res.json() as Promise<Profile>;
}

export async function updateProfile(
  token: string,
  id: string,
  body: ProfileUpdatePayload,
): Promise<Profile> {
  const res = await fetch(`${BASE}/${id}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw res;
  return res.json() as Promise<Profile>;
}

export async function deleteProfile(token: string, id: string): Promise<void> {
  const res = await fetch(`${BASE}/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw res;
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
  id: string,
  message: string,
): Promise<OptimizeProfileResponse> {
  const res = await fetch(`${BASE}/${id}/optimize`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) throw res;
  return res.json() as Promise<OptimizeProfileResponse>;
}

export async function enhanceField(
  token: string,
  id: string,
  content: string,
  fieldPurpose: string,
): Promise<string> {
  const res = await fetch(`${BASE}/${id}/enhance-field`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, fieldPurpose }),
  });
  if (!res.ok) throw res;
  const data = await res.json() as { enhanced: string };
  return data.enhanced;
}

export async function extractProfileFromCv(
  token: string,
  id: string,
  file: File,
): Promise<Profile> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${BASE}/${id}/extract`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  if (!res.ok) throw res;
  return res.json() as Promise<Profile>;
}

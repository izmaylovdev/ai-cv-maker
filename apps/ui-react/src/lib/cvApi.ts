import { environment } from '../environments/environment';

const BASE = `${environment.apiUrl}/job-profiles`;

export type CvListItem = {
  id: string;
  createdAt: string;
  optimizationNotes?: string | null;
  title: string;
};

function cvBase(profileId: string) {
  return `${BASE}/${profileId}/cvs`;
}

export async function listCvs(token: string, profileId: string): Promise<CvListItem[]> {
  const res = await fetch(cvBase(profileId), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw res;
  return res.json() as Promise<CvListItem[]>;
}

export async function createCv(
  token: string,
  profileId: string,
  optimizationNotes?: string | null,
): Promise<CvListItem> {
  const res = await fetch(cvBase(profileId), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ optimizationNotes: optimizationNotes ?? null }),
  });
  if (!res.ok) throw res;
  return res.json() as Promise<CvListItem>;
}

export async function getDefaultCvPdf(token: string, profileId: string): Promise<Blob> {
  const res = await fetch(`${cvBase(profileId)}/default/pdf`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw res;
  return res.blob();
}

export async function getCvPdf(token: string, profileId: string, id: string): Promise<Blob> {
  const res = await fetch(`${cvBase(profileId)}/${id}/pdf`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw res;
  return res.blob();
}

export async function deleteCv(token: string, profileId: string, id: string): Promise<void> {
  const res = await fetch(`${cvBase(profileId)}/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw res;
}

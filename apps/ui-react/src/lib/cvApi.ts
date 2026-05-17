import { environment } from '../environments/environment';

const CV_BASE = `${environment.apiUrl}/cv`;

export type CvListItem = {
  id: string;
  createdAt: string;
  optimizationNotes?: string | null;
  title: string;
};

export async function listCvs(token: string): Promise<CvListItem[]> {
  const res = await fetch(CV_BASE, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw res;
  return res.json() as Promise<CvListItem[]>;
}

export async function createCv(
  token: string,
  optimizationNotes?: string | null,
): Promise<CvListItem> {
  const res = await fetch(CV_BASE, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ optimizationNotes: optimizationNotes ?? null }),
  });
  if (!res.ok) throw res;
  return res.json() as Promise<CvListItem>;
}

export async function getDefaultCvPdf(token: string): Promise<Blob> {
  const res = await fetch(`${CV_BASE}/default/pdf`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw res;
  return res.blob();
}

export async function getCvPdf(token: string, id: string): Promise<Blob> {
  const res = await fetch(`${CV_BASE}/${id}/pdf`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw res;
  return res.blob();
}

export async function deleteCv(token: string, id: string): Promise<void> {
  const res = await fetch(`${CV_BASE}/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw res;
}

import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { environment } from '../../../environments/environment';

const BASE = `${environment.apiUrl}/job-profiles`;

export interface CvListItem {
  id: string;
  createdAt: string;
  optimizationNotes?: string | null;
  title: string;
}

@Injectable({ providedIn: 'root' })
export class CvService {
  private http = inject(HttpClient);

  private api(profileId: string) {
    return `${BASE}/${profileId}/cvs`;
  }

  list(profileId: string) {
    return this.http.get<CvListItem[]>(this.api(profileId));
  }

  create(profileId: string, optimizationNotes?: string | null) {
    return this.http.post<CvListItem>(this.api(profileId), { optimizationNotes: optimizationNotes ?? null });
  }

  getPdf(profileId: string, id: string) {
    return this.http.get(`${this.api(profileId)}/${id}/pdf`, { responseType: 'blob' });
  }

  getDefaultPdf(profileId: string) {
    return this.http.get(`${this.api(profileId)}/default/pdf`, { responseType: 'blob' });
  }

  deleteCv(profileId: string, id: string) {
    return this.http.delete(`${this.api(profileId)}/${id}`);
  }
}

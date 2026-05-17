import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { environment } from '../../../environments/environment';

const API = `${environment.apiUrl}/cv`;

export interface CvListItem {
  id: string;
  createdAt: string;
  optimizationNotes?: string | null;
  title: string;
}

@Injectable({ providedIn: 'root' })
export class CvService {
  private http = inject(HttpClient);

  list() {
    return this.http.get<CvListItem[]>(API);
  }

  create(optimizationNotes?: string | null) {
    return this.http.post<CvListItem>(API, { optimizationNotes: optimizationNotes ?? null });
  }

  getPdf(id: string) {
    return this.http.get(`${API}/${id}/pdf`, { responseType: 'blob' });
  }

  getDefaultPdf() {
    return this.http.get(`${API}/default/pdf`, { responseType: 'blob' });
  }

  deleteCv(id: string) {
    return this.http.delete(`${API}/${id}`);
  }
}

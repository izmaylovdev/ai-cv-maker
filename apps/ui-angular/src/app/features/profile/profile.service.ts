import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { environment } from '../../../environments/environment';
import { JobProfile, JobProfileListItem, ProfileDocument } from '../../shared/models/profile.model';

const BASE = `${environment.apiUrl}/job-profiles`;

/** What the user edits and saves: the profile's label plus its document. */
export interface ProfileUpdate {
  name: string;
  document: ProfileDocument;
}

@Injectable({ providedIn: 'root' })
export class ProfileService {
  private http = inject(HttpClient);

  listProfiles() {
    return this.http.get<JobProfileListItem[]>(BASE);
  }

  createProfile(name: string) {
    return this.http.post<JobProfileListItem>(BASE, { name });
  }

  deleteProfile(id: string) {
    return this.http.delete(`${BASE}/${id}`);
  }

  getProfile(id: string) {
    return this.http.get<JobProfile>(`${BASE}/${id}`);
  }

  updateProfile(id: string, update: ProfileUpdate) {
    return this.http.put<JobProfile>(`${BASE}/${id}`, update);
  }

  /** AI-rewrites the profile for the given goal; returns the new document for review. */
  optimizeProfile(id: string, message: string) {
    return this.http.post<{ document: ProfileDocument }>(`${BASE}/${id}/optimize`, { message });
  }

  /** Extracts a document (and a suggested name) from an uploaded CV file. */
  extractFromCv(id: string, file: File) {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<{ name: string; document: ProfileDocument }>(`${BASE}/${id}/extract`, formData);
  }
}

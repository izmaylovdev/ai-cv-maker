import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { environment } from '../../../environments/environment';
import { JobProfileListItem, Profile } from '../../shared/models/profile.model';

const BASE = `${environment.apiUrl}/job-profiles`;

export interface OptimizeWorkExperience {
  company: string;
  role: string;
  startDate: string;
  endDate?: string;
  description: string;
}

export interface OptimizeProfileResponse {
  title: string;
  overview: string;
  workExperiences: OptimizeWorkExperience[];
  skills: { name: string }[];
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
    return this.http.get<Profile>(`${BASE}/${id}`);
  }

  updateProfile(id: string, profile: Omit<Profile, 'id'>) {
    return this.http.put<Profile>(`${BASE}/${id}`, profile);
  }

  optimizeProfile(id: string, message: string) {
    return this.http.post<OptimizeProfileResponse>(`${BASE}/${id}/optimize`, { message });
  }

  enhanceField(id: string, content: string, fieldPurpose: string) {
    return this.http.post<{ enhanced: string }>(`${BASE}/${id}/enhance-field`, { content, fieldPurpose });
  }

  extractFromCv(id: string, file: File) {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<Omit<Profile, 'id'>>(`${BASE}/${id}/extract`, formData);
  }
}

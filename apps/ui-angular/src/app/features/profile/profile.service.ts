import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { environment } from '../../../environments/environment';
import { Profile } from '../../shared/models/profile.model';

const API = `${environment.apiUrl}/profile`;

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

  getProfile() {
    return this.http.get<Profile>(API);
  }

  updateProfile(profile: Omit<Profile, 'id'>) {
    return this.http.put<Profile>(API, profile);
  }

  optimizeProfile(message: string) {
    return this.http.post<OptimizeProfileResponse>(`${API}/optimize`, { message });
  }
}

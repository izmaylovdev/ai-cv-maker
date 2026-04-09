import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Profile } from '../shared/models/profile.model';

const API = 'http://localhost:5050/api/profile';

@Injectable({ providedIn: 'root' })
export class ProfileService {
  private http = inject(HttpClient);

  getProfile() {
    return this.http.get<Profile>(API);
  }

  updateProfile(profile: Omit<Profile, 'id'>) {
    return this.http.put<Profile>(API, profile);
  }
}

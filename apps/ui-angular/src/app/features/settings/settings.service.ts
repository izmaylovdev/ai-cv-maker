import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { environment } from '../../../environments/environment';

export interface UserPreferences {
  globalPreferences: string | null;
}

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/settings`;

  get() {
    return this.http.get<UserPreferences>(`${this.base}/preferences`);
  }

  save(globalPreferences: string) {
    return this.http.put<UserPreferences>(`${this.base}/preferences`, { globalPreferences });
  }
}

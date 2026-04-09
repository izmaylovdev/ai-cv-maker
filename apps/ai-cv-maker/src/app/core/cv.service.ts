import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

const API = 'http://localhost:5050/api/cv';

@Injectable({ providedIn: 'root' })
export class CvService {
  private http = inject(HttpClient);

  generate() {
    return this.http.post(`${API}/generate`, {}, { responseType: 'blob' });
  }
}

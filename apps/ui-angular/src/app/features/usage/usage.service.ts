import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';

export interface UsageSummary {
  promptTokens: number;
  completionTokens: number;
  estimatedCostUsd: number;
  limitUsd: number;
}

@Injectable({ providedIn: 'root' })
export class UsageService {
  private http = inject(HttpClient);

  getMyUsage() {
    return this.http.get<UsageSummary>('/api/usage');
  }
}

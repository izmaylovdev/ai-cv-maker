import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';

export interface BillingSummary {
  allowanceUsd: number;
  spentUsd: number;
  balanceUsd: number;
  currency: string;
  promptTokens: number;
  completionTokens: number;
}

@Injectable({ providedIn: 'root' })
export class BillingService {
  private http = inject(HttpClient);

  getMyBilling() {
    return this.http.get<BillingSummary>('/api/billing');
  }
}

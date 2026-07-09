import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';

export interface BillingSummary {
  allowanceUsd: number;
  spentUsd: number;
  balanceUsd: number;
  currency: string;
  promptTokens: number;
  completionTokens: number;
  country: string | null;
}

export interface TopUpCreated {
  paymentId: string;
  channel: string;
  redirectUrl: string;
}

export interface TopUpRecord {
  id: string;
  amountUsd: number;
  channel: string;
  status: 'Pending' | 'Paid' | 'Failed';
  createdAt: string;
}

@Injectable({ providedIn: 'root' })
export class BillingService {
  private http = inject(HttpClient);

  getMyBilling() {
    return this.http.get<BillingSummary>('/api/billing');
  }

  updateCountry(country: string) {
    return this.http.put<void>('/api/billing/country', { country });
  }

  createTopUp(amountUsd: number) {
    return this.http.post<TopUpCreated>('/api/billing/top-up', { amountUsd });
  }

  getTopUps() {
    return this.http.get<TopUpRecord[]>('/api/billing/top-ups');
  }
}

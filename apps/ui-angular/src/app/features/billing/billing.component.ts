import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { BillingService, BillingSummary } from './billing.service';

@Component({
  selector: 'app-billing',
  standalone: true,
  imports: [DecimalPipe],
  template: `
    <div class="max-w-2xl mx-auto py-8 px-4">
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white mb-2">Billing</h1>
      <p class="text-sm text-gray-500 dark:text-zinc-400 mb-8">Your AI spending balance to date.</p>

      @if (loading()) {
        <p class="text-sm text-gray-400 dark:text-zinc-500">Loading…</p>
      } @else if (error()) {
        <p class="text-sm text-red-500">Could not load billing data.</p>
      } @else {
        <div class="grid grid-cols-3 gap-4">
          <div class="rounded-lg border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 p-5">
            <p class="text-xs uppercase tracking-wide text-gray-500 dark:text-zinc-400 mb-1">Balance</p>
            <p class="text-2xl font-semibold text-gray-900 dark:text-white">\${{ billing()?.balanceUsd | number: '1.2-2' }}</p>
          </div>
          <div class="rounded-lg border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 p-5">
            <p class="text-xs uppercase tracking-wide text-gray-500 dark:text-zinc-400 mb-1">Allowance</p>
            <p class="text-2xl font-semibold text-gray-900 dark:text-white">\${{ billing()?.allowanceUsd | number: '1.2-2' }}</p>
          </div>
          <div class="rounded-lg border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 p-5">
            <p class="text-xs uppercase tracking-wide text-gray-500 dark:text-zinc-400 mb-1">Spent</p>
            <p class="text-2xl font-semibold text-gray-900 dark:text-white">\${{ billing()?.spentUsd | number: '1.2-2' }}</p>
          </div>
        </div>

        <div class="mt-4 grid grid-cols-2 gap-4">
          <div class="rounded-lg border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 p-5">
            <p class="text-xs uppercase tracking-wide text-gray-500 dark:text-zinc-400 mb-1">Prompt tokens</p>
            <p class="text-2xl font-semibold text-gray-900 dark:text-white">{{ billing()?.promptTokens | number }}</p>
          </div>
          <div class="rounded-lg border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 p-5">
            <p class="text-xs uppercase tracking-wide text-gray-500 dark:text-zinc-400 mb-1">Completion tokens</p>
            <p class="text-2xl font-semibold text-gray-900 dark:text-white">{{ billing()?.completionTokens | number }}</p>
          </div>
        </div>

        <div class="mt-6 rounded-lg border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 p-5">
          <div class="flex items-baseline justify-between mb-2">
            <p class="text-xs uppercase tracking-wide text-gray-500 dark:text-zinc-400">Spending allowance</p>
            <p class="text-sm text-gray-600 dark:text-zinc-300">{{ usedPct() | number: '1.0-0' }}% used</p>
          </div>
          <div class="h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-zinc-700">
            <div
              class="h-full rounded-full transition-all"
              [class.bg-blue-500]="usedPct() < 100"
              [class.bg-red-500]="usedPct() >= 100"
              [style.width.%]="usedPct()"
            ></div>
          </div>
          <p class="mt-2 text-xs text-gray-500 dark:text-zinc-400">
            @if (balance() > 0) {
              You still have balance remaining.
            } @else {
              You've reached your AI spending allowance.
            }
          </p>
        </div>
      }
    </div>
  `,
})
export class BillingComponent implements OnInit {
  private billingService = inject(BillingService);

  readonly loading = signal(true);
  readonly error = signal(false);
  readonly billing = signal<BillingSummary | null>(null);

  readonly balance = computed(() => {
    const b = this.billing();
    return b ? b.balanceUsd : 0;
  });

  readonly usedPct = computed(() => {
    const b = this.billing();
    if (!b || b.allowanceUsd <= 0) return 0;
    return Math.min(100, (b.spentUsd / b.allowanceUsd) * 100);
  });

  ngOnInit() {
    this.billingService.getMyBilling().subscribe({
      next: (data) => {
        this.billing.set(data);
        this.loading.set(false);
      },
      error: () => {
        this.error.set(true);
        this.loading.set(false);
      },
    });
  }
}

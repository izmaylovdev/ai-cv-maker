import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { UsageService, UsageSummary } from './usage.service';

@Component({
  selector: 'app-usage',
  standalone: true,
  imports: [DecimalPipe],
  template: `
    <div class="max-w-2xl mx-auto py-8 px-4">
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white mb-2">Usage</h1>
      <p class="text-sm text-gray-500 dark:text-zinc-400 mb-8">Your AI token consumption to date.</p>

      @if (loading()) {
        <p class="text-sm text-gray-400 dark:text-zinc-500">Loading…</p>
      } @else if (error()) {
        <p class="text-sm text-red-500">Could not load usage data.</p>
      } @else {
        <div class="grid grid-cols-3 gap-4">
          <div class="rounded-lg border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 p-5">
            <p class="text-xs uppercase tracking-wide text-gray-500 dark:text-zinc-400 mb-1">Prompt tokens</p>
            <p class="text-2xl font-semibold text-gray-900 dark:text-white">{{ usage()?.promptTokens | number }}</p>
          </div>
          <div class="rounded-lg border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 p-5">
            <p class="text-xs uppercase tracking-wide text-gray-500 dark:text-zinc-400 mb-1">Completion tokens</p>
            <p class="text-2xl font-semibold text-gray-900 dark:text-white">{{ usage()?.completionTokens | number }}</p>
          </div>
          <div class="rounded-lg border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 p-5">
            <p class="text-xs uppercase tracking-wide text-gray-500 dark:text-zinc-400 mb-1">Estimated cost</p>
            <p class="text-2xl font-semibold text-gray-900 dark:text-white">\${{ usage()?.estimatedCostUsd | number: '1.4-4' }}</p>
          </div>
        </div>

        <div class="mt-6 rounded-lg border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 p-5">
          <div class="flex items-baseline justify-between mb-2">
            <p class="text-xs uppercase tracking-wide text-gray-500 dark:text-zinc-400">Spending limit</p>
            <p class="text-sm text-gray-600 dark:text-zinc-300">
              \${{ usage()?.estimatedCostUsd | number: '1.2-2' }} of \${{ usage()?.limitUsd | number: '1.2-2' }} used
            </p>
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
            @if (remaining() > 0) {
              \${{ remaining() | number: '1.2-2' }} remaining
            } @else {
              You've reached your AI spending limit.
            }
          </p>
        </div>
      }
    </div>
  `,
})
export class UsageComponent implements OnInit {
  private usageService = inject(UsageService);

  readonly loading = signal(true);
  readonly error = signal(false);
  readonly usage = signal<UsageSummary | null>(null);

  readonly remaining = computed(() => {
    const u = this.usage();
    return u ? Math.max(0, u.limitUsd - u.estimatedCostUsd) : 0;
  });

  readonly usedPct = computed(() => {
    const u = this.usage();
    if (!u || u.limitUsd <= 0) return 0;
    return Math.min(100, (u.estimatedCostUsd / u.limitUsd) * 100);
  });

  ngOnInit() {
    this.usageService.getMyUsage().subscribe({
      next: (data) => {
        this.usage.set(data);
        this.loading.set(false);
      },
      error: () => {
        this.error.set(true);
        this.loading.set(false);
      },
    });
  }
}

import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { BillingService, BillingSummary, TopUpRecord } from './billing.service';
import { COUNTRIES, Country } from './countries';

const TOP_UP_AMOUNTS = [5, 10, 20] as const;

/** How many times / how often we re-check the summary after a successful payment redirect. */
const SUCCESS_POLL_ATTEMPTS = 5;
const SUCCESS_POLL_INTERVAL_MS = 1000;

@Component({
  selector: 'app-billing',
  standalone: true,
  imports: [DecimalPipe, DatePipe],
  template: `
    <div class="max-w-2xl mx-auto py-8 px-4">
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white mb-2">Billing</h1>
      <p class="text-sm text-gray-500 dark:text-zinc-400 mb-8">Your AI spending balance to date.</p>

      @if (banner() === 'success') {
        <div class="mb-6 rounded-lg border border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/30 px-4 py-3 text-sm text-green-800 dark:text-green-200">
          Payment successful — your balance will update in a moment.
        </div>
      } @else if (banner() === 'incomplete') {
        <div class="mb-6 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
          Your payment didn't complete. You haven't been charged.
        </div>
      }

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

        <!-- Top-up card (US-BILL-1) -->
        <div class="mt-6 rounded-lg border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 p-5">
          <p class="text-xs uppercase tracking-wide text-gray-500 dark:text-zinc-400 mb-1">Top up</p>
          <p class="text-sm text-gray-600 dark:text-zinc-300 mb-4">Add credit to your AI spending allowance.</p>
          <div class="flex gap-3">
            @for (amount of amounts; track amount) {
              <button
                type="button"
                class="flex-1 rounded-lg border border-blue-500 bg-blue-500 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-600 disabled:opacity-50"
                [disabled]="topUpBusy()"
                (click)="startTopUp(amount)"
              >
                \${{ amount }}
              </button>
            }
          </div>
          @if (topUpError()) {
            <p class="mt-3 text-sm text-red-500">Could not start the payment. Please try again.</p>
          }

          <!-- Payment country row -->
          <div class="mt-5 flex items-center justify-between border-t border-gray-200 dark:border-zinc-700 pt-4">
            <div>
              <p class="text-xs uppercase tracking-wide text-gray-500 dark:text-zinc-400 mb-1">Payment country</p>
              @if (countryName()) {
                <p class="text-sm text-gray-900 dark:text-white">{{ countryName() }}</p>
              } @else {
                <p class="text-sm text-gray-500 dark:text-zinc-400">Not set — you'll pick it at your first top-up.</p>
              }
            </div>
            @if (countryName()) {
              <button
                type="button"
                class="rounded-lg border border-gray-300 dark:border-zinc-600 px-3 py-1.5 text-sm text-gray-700 dark:text-zinc-200 hover:bg-gray-50 dark:hover:bg-zinc-700"
                (click)="openCountryPicker(null)"
              >
                Change
              </button>
            }
          </div>

          <!-- Country picker step -->
          @if (countryPickerOpen()) {
            <div class="mt-4 rounded-lg border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-900 p-4">
              <p class="text-sm font-medium text-gray-900 dark:text-white mb-2">
                @if (pendingAmountUsd() !== null) {
                  Where are you paying from? We use this to pick your payment method.
                } @else {
                  Select your country
                }
              </p>
              <input
                type="text"
                placeholder="Search country"
                class="w-full rounded-lg border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                [value]="countrySearch()"
                (input)="countrySearch.set(searchValue($event))"
              />
              <ul class="mt-2 max-h-48 overflow-y-auto rounded-lg border border-gray-200 dark:border-zinc-700 divide-y divide-gray-100 dark:divide-zinc-700" role="listbox">
                @for (c of filteredCountries(); track c.code) {
                  <li role="option" [attr.aria-selected]="c.code === selectedCountry()?.code">
                    <button
                      type="button"
                      class="w-full px-3 py-2 text-left text-sm text-gray-900 dark:text-white hover:bg-blue-50 dark:hover:bg-zinc-700"
                      [class.bg-blue-100]="c.code === selectedCountry()?.code"
                      [class.dark:bg-zinc-600]="c.code === selectedCountry()?.code"
                      (click)="selectCountry(c)"
                    >
                      {{ c.name }}
                    </button>
                  </li>
                } @empty {
                  <li class="px-3 py-2 text-sm text-gray-500 dark:text-zinc-400">No countries match.</li>
                }
              </ul>
              <div class="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  class="rounded-lg px-3 py-1.5 text-sm text-gray-600 dark:text-zinc-300 hover:bg-gray-100 dark:hover:bg-zinc-700"
                  (click)="closeCountryPicker()"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  class="rounded-lg bg-blue-500 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-600 disabled:opacity-50"
                  [disabled]="!selectedCountry() || topUpBusy()"
                  (click)="confirmCountry()"
                >
                  Confirm
                </button>
              </div>
            </div>
          }
        </div>

        <!-- Top-up history -->
        <div class="mt-6 rounded-lg border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 p-5">
          <p class="text-xs uppercase tracking-wide text-gray-500 dark:text-zinc-400 mb-3">Top-up history</p>
          @if (topUps().length === 0) {
            <p class="text-sm text-gray-500 dark:text-zinc-400">No top-ups yet.</p>
          } @else {
            <table class="w-full text-sm">
              <thead>
                <tr class="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-zinc-400">
                  <th class="pb-2 font-medium">Date</th>
                  <th class="pb-2 font-medium">Amount</th>
                  <th class="pb-2 font-medium">Channel</th>
                  <th class="pb-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                @for (t of topUps(); track t.id) {
                  <tr class="border-t border-gray-100 dark:border-zinc-700 text-gray-900 dark:text-white">
                    <td class="py-2">{{ t.createdAt | date: 'medium' }}</td>
                    <td class="py-2">\${{ t.amountUsd | number: '1.2-2' }}</td>
                    <td class="py-2">{{ t.channel }}</td>
                    <td class="py-2">
                      <span
                        class="rounded-full px-2 py-0.5 text-xs font-medium"
                        [class.bg-yellow-100]="t.status === 'Pending'"
                        [class.text-yellow-800]="t.status === 'Pending'"
                        [class.bg-green-100]="t.status === 'Paid'"
                        [class.text-green-800]="t.status === 'Paid'"
                        [class.bg-red-100]="t.status === 'Failed'"
                        [class.text-red-800]="t.status === 'Failed'"
                      >
                        {{ t.status }}
                      </span>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          }
        </div>
      }
    </div>
  `,
})
export class BillingComponent implements OnInit, OnDestroy {
  private billingService = inject(BillingService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  readonly amounts = TOP_UP_AMOUNTS;

  readonly loading = signal(true);
  readonly error = signal(false);
  readonly billing = signal<BillingSummary | null>(null);
  readonly topUps = signal<TopUpRecord[]>([]);

  readonly banner = signal<'success' | 'incomplete' | null>(null);
  readonly topUpBusy = signal(false);
  readonly topUpError = signal(false);

  readonly countryPickerOpen = signal(false);
  readonly countrySearch = signal('');
  readonly selectedCountry = signal<Country | null>(null);
  /** Amount waiting for the country step to finish; null when just editing the country. */
  readonly pendingAmountUsd = signal<number | null>(null);

  private pollTimer: ReturnType<typeof setTimeout> | null = null;

  readonly balance = computed(() => {
    const b = this.billing();
    return b ? b.balanceUsd : 0;
  });

  readonly usedPct = computed(() => {
    const b = this.billing();
    if (!b || b.allowanceUsd <= 0) return 0;
    return Math.min(100, (b.spentUsd / b.allowanceUsd) * 100);
  });

  readonly countryName = computed(() => {
    const code = this.billing()?.country;
    if (!code) return null;
    return COUNTRIES.find((c) => c.code === code)?.name ?? code;
  });

  readonly filteredCountries = computed(() => {
    const term = this.countrySearch().trim().toLowerCase();
    if (!term) return COUNTRIES;
    return COUNTRIES.filter(
      (c) => c.name.toLowerCase().includes(term) || c.code.toLowerCase() === term,
    );
  });

  ngOnInit() {
    this.loadSummary(() => this.loading.set(false));
    this.loadTopUps();
    this.handlePaymentReturn();
  }

  ngOnDestroy() {
    if (this.pollTimer !== null) clearTimeout(this.pollTimer);
  }

  searchValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  startTopUp(amountUsd: number) {
    this.topUpError.set(false);
    if (!this.billing()?.country) {
      // First top-up: ask for the country before starting the payment.
      this.openCountryPicker(amountUsd);
      return;
    }
    this.createTopUp(amountUsd);
  }

  openCountryPicker(pendingAmountUsd: number | null) {
    this.pendingAmountUsd.set(pendingAmountUsd);
    this.countrySearch.set('');
    this.selectedCountry.set(null);
    this.countryPickerOpen.set(true);
  }

  closeCountryPicker() {
    this.countryPickerOpen.set(false);
    this.pendingAmountUsd.set(null);
  }

  selectCountry(country: Country) {
    this.selectedCountry.set(country);
  }

  confirmCountry() {
    const country = this.selectedCountry();
    if (!country) return;
    this.topUpBusy.set(true);
    this.billingService.updateCountry(country.code).subscribe({
      next: () => {
        this.billing.update((b) => (b ? { ...b, country: country.code } : b));
        const amount = this.pendingAmountUsd();
        this.closeCountryPicker();
        if (amount !== null) {
          this.createTopUp(amount);
        } else {
          this.topUpBusy.set(false);
        }
      },
      error: () => {
        this.topUpBusy.set(false);
        this.topUpError.set(true);
      },
    });
  }

  private createTopUp(amountUsd: number) {
    this.topUpBusy.set(true);
    this.billingService.createTopUp(amountUsd).subscribe({
      next: ({ redirectUrl }) => {
        window.location.assign(redirectUrl);
      },
      error: () => {
        this.topUpBusy.set(false);
        this.topUpError.set(true);
      },
    });
  }

  private loadSummary(done?: () => void) {
    this.billingService.getMyBilling().subscribe({
      next: (data) => {
        this.billing.set(data);
        done?.();
      },
      error: () => {
        this.error.set(true);
        done?.();
      },
    });
  }

  private loadTopUps(done?: () => void) {
    this.billingService.getTopUps().subscribe({
      next: (rows) => {
        this.topUps.set(rows);
        done?.();
      },
      error: () => done?.(),
    });
  }

  /** Handles ?topup=<id>&outcome=<success|cancelled|failure> after a provider redirect. */
  private handlePaymentReturn() {
    const params = this.route.snapshot.queryParamMap;
    const paymentId = params.get('topup');
    const outcome = params.get('outcome');
    if (!paymentId || !outcome) return;

    if (outcome === 'success') {
      this.banner.set('success');
      // The webhook credits the balance asynchronously — poll a few times until
      // the payment leaves Pending so the new allowance shows up.
      this.pollAfterSuccess(paymentId, SUCCESS_POLL_ATTEMPTS);
    } else if (outcome === 'cancelled' || outcome === 'failure') {
      this.banner.set('incomplete');
    }

    // Strip the handled params from the URL.
    this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
  }

  private pollAfterSuccess(paymentId: string, attemptsLeft: number) {
    if (attemptsLeft <= 0) return;
    this.pollTimer = setTimeout(() => {
      this.loadSummary();
      this.loadTopUps(() => {
        const payment = this.topUps().find((t) => t.id === paymentId);
        if (payment && payment.status !== 'Pending') return; // webhook landed
        this.pollAfterSuccess(paymentId, attemptsLeft - 1);
      });
    }, SUCCESS_POLL_INTERVAL_MS);
  }
}

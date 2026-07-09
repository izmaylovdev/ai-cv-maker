# Spec — Billing & Payments

Technical spec for the `billing` area ([user stories](../user-stories/billing.md)).
Builds on the per-user billing balance from US-AI-14 (spec: [ai-enhancement.md §14](ai-enhancement.md)).

---

## 1. Balance Top-Up via Country-Based Payment Channels (US-BILL-1)

Users buy credit that increases their `BillingAccount.AllowanceUsd`. The payment
channel is selected by the user's stored country: `UA` → Monobank acquiring
(invoice), every other country → Stripe Checkout. The country is asked once, at
first payment, and stored on the user.

### 1.1 Functional Requirements

| # | Requirement |
|---|-------------|
| F-BILL-1.1 | The Billing page offers a Top up action with fixed amounts: $5, $10, $20. |
| F-BILL-1.2 | A top-up requires a stored country. If the user has none, the UI asks for it (searchable country select) before the payment starts; the choice is persisted and not asked again. |
| F-BILL-1.3 | The stored country is shown on the Billing page and can be changed there at any time before a payment. |
| F-BILL-1.4 | Channel routing: country `UA` → Monobank invoice; any other country → Stripe Checkout. The chosen channel is recorded on the payment and visible in history. |
| F-BILL-1.5 | A confirmed successful payment increases the user's allowance by exactly the paid USD amount, exactly once (webhook retries must not double-credit). Blocked AI actions work again once the new allowance exceeds accrued spend. |
| F-BILL-1.6 | A cancelled, failed, or expired payment leaves allowance, spend, and balance untouched, and the Billing page tells the user the payment didn't complete. |
| F-BILL-1.7 | The Billing page lists the user's top-up history (date, amount, channel, status: pending / paid / failed), newest first. |
| F-BILL-1.8 | All billing endpoints except provider webhooks require JWT auth and operate only on the caller's own data. Webhook endpoints are anonymous but signature/token-verified. |
| F-BILL-1.9 | In local/dev without provider credentials, a fake-provider mode completes the full flow (correct channel chosen, fake payment page, success/cancel outcomes) so the feature is testable end-to-end. |
| F-BILL-1.10 | Top-up UI renders correctly in light and dark themes. |

### 1.2 Technical Specification

#### Data model

`Users` gains one nullable column:

| Column | Type | Notes |
|---|---|---|
| `Country` | `varchar(2)`, nullable | ISO 3166-1 alpha-2, uppercase. `null` = never asked. |

New table `TopUpPayments`:

| Column | Type | Notes |
|---|---|---|
| `Id` | `uuid` PK | |
| `UserId` | `uuid`, FK → Users, indexed | |
| `AmountUsd` | `numeric` | one of 5, 10, 20 |
| `Channel` | `text` | `stripe` \| `monobank` \| `fake-stripe` \| `fake-monobank` |
| `Status` | `text` | `Pending` \| `Paid` \| `Failed` |
| `ExternalId` | `text`, nullable, unique | Stripe session id / Monobank `invoiceId` / fake id |
| `CreatedAt`, `UpdatedAt` | `timestamptz` | |

EF Core migration `AddBillingTopUps` (adds both the column and the table), in
`apps/cv-api/Infrastructure/Persistence/Migrations/`.

**Crediting rule (F-BILL-1.5):** on success, if the user already has a
`BillingAccount` row, add `AmountUsd` to it. If not, create one with
`AllowanceUsd = (current effective allowance from UsageService.GetEffectiveAllowanceAsync) + AmountUsd`
— creating a zero-based row would silently erase the user's default allowance.
Credit only on a `Pending → Paid` transition; any webhook for a payment already
`Paid` or `Failed` is acknowledged (200) and ignored.

#### Payment channel abstraction

`apps/cv-api/Features/Billing/Channels/`:

```csharp
public interface IPaymentChannel
{
    string Name { get; }                       // "stripe" | "monobank"
    // Creates the provider-side payment and returns (externalId, redirectUrl)
    Task<PaymentRedirect> CreatePaymentAsync(TopUpPayment payment, CancellationToken ct);
}
```

`PaymentChannelResolver.Resolve(string country)` → `"UA"` → monobank channel,
anything else → stripe channel. Registered channels depend on config
(fake mode replaces both with fake implementations, same names).

- **StripeChannel** — uses the official `Stripe.net` NuGet package. Creates a
  Checkout Session: `mode=payment`, one line item (`unit_amount` = USD cents,
  `currency=usd`, product name "Applysy balance top-up"),
  `success_url = {SpaBaseUrl}/billing?topup={paymentId}&outcome=success`,
  `cancel_url = {SpaBaseUrl}/billing?topup={paymentId}&outcome=cancelled`,
  `client_reference_id = paymentId`. `ExternalId` = session id.
- **MonobankChannel** — `POST https://api.monobank.ua/api/merchant/invoice/create`
  with header `X-Token`. Body: `amount` (kopecks: `AmountUsd × UahPerUsd × 100`,
  rounded), `ccy: 980`, `redirectUrl` (same SPA URL as above),
  `webHookUrl = {PublicBaseUrl}/api/billing/webhooks/monobank`,
  `reference = paymentId`. Response gives `invoiceId` (→ `ExternalId`) and
  `pageUrl` (→ redirect). Balance is still credited in USD by `AmountUsd`;
  `UahPerUsd` is a configured fixed rate, not a live FX lookup.
- **Fake channels (F-BILL-1.9)** — when `Billing:Payments:UseFakeProviders` is
  true, both channel names resolve to fake implementations whose redirect URL is
  the local page `GET /api/billing/fake-pay/{paymentId}` — a minimal HTML page
  labeled with the channel name, with **Pay** and **Cancel** buttons that call
  `POST /api/billing/fake-pay/{paymentId}/complete` with `outcome=success|failure`
  (marks the payment via the same confirmation code path as real webhooks) and
  redirect back to `/billing?topup={paymentId}&outcome=…`. Fake endpoints return
  404 when fake mode is off.

#### API

All under `BillingController` (`/api/billing`), `[Authorize]` unless noted.

`GET /api/billing` — extended response (adds `country`):

```json
{ "allowanceUsd": 5.5, "spentUsd": 0.42, "balanceUsd": 5.08, "currency": "USD",
  "promptTokens": 1200, "completionTokens": 800, "country": "UA" }
```

`PUT /api/billing/country`

```json
{ "country": "UA" }
```

Response 204. Errors — 400: not a two-letter uppercase ISO alpha-2 code.

`POST /api/billing/top-up`

```json
{ "amountUsd": 10 }
```

Response 200:

```json
{ "paymentId": "…", "channel": "monobank", "redirectUrl": "https://pay.mbnk.biz/…" }
```

Errors — 400: amount not in {5, 10, 20}; 409: no country stored yet
(client must ask for country first); 502: provider call failed.

`GET /api/billing/top-ups` — Response 200, newest first:

```json
[ { "id": "…", "amountUsd": 10, "channel": "monobank", "status": "Paid",
    "createdAt": "2026-07-06T10:00:00Z" } ]
```

Webhooks (`[AllowAnonymous]`):

- `POST /api/billing/webhooks/stripe` — verifies the `Stripe-Signature` header
  against `Billing:Payments:Stripe:WebhookSecret`; on
  `checkout.session.completed` marks the payment (looked up by session id /
  `client_reference_id`) Paid; on `checkout.session.expired` marks it Failed.
  Invalid signature → 400.
- `POST /api/billing/webhooks/monobank` — verifies the `X-Sign` ECDSA signature
  per Monobank's webhook-verify doc (public key fetched from
  `GET /api/merchant/pubkey`, cached); maps `status`: `success` → Paid;
  `failure` / `expired` / `reversed` → Failed; `created` / `processing` /
  `hold` → ignored. Duplicate/out-of-order deliveries are tolerated
  (terminal statuses never regress; credits are idempotent per F-BILL-1.5).

#### Configuration

```json
"Billing": {
  "DefaultAllowanceUsd": 0.50,
  "Payments": {
    "UseFakeProviders": true,
    "PublicBaseUrl": "http://localhost:5000",
    "SpaBaseUrl": "http://localhost:4200",
    "Stripe": { "SecretKey": "", "WebhookSecret": "" },
    "Monobank": { "Token": "", "UahPerUsd": 42.0 }
  }
}
```

`UseFakeProviders` defaults to **false**; it is set true in
`appsettings.Development.json`. Real secrets live in .NET User Secrets locally
and env vars in deployment, never in appsettings.

#### Angular

`features/billing/` (extends the US-AI-14 page):

- `billing.service.ts` — add `updateCountry(country)`, `createTopUp(amountUsd)`,
  `getTopUps()`; extend `BillingSummary` with `country: string | null`.
- `countries.ts` — full ISO 3166-1 alpha-2 list (`{ code, name }[]`) as a constant.
- `billing.component.ts` —
  - Top-up card: three amount buttons; clicking one either opens the country
    step (no country saved) or calls `createTopUp` and navigates to
    `redirectUrl` (`window.location.assign`).
  - Country step/section: searchable `<select>`; saves via `updateCountry`,
    then proceeds with the pending top-up. Also rendered as an editable
    "Payment country" row once set.
  - History table from `getTopUps()`.
  - On load, reads `?topup&outcome` query params: `outcome=success` shows a
    success banner (and refetches summary until the webhook has landed —
    poll summary+history a few times if status is still Pending);
    `outcome=cancelled|failure` shows a "payment didn't complete" banner.
    Params are then stripped from the URL.

No new routes; `/billing` stays auth-guarded.

#### Out of scope (MVP)

- Subscriptions/recurring payments, custom top-up amounts, refunds.
- Receipts, invoices for accounting, VAT handling.
- Live FX rates for UAH (fixed configured rate).
- Saved cards / tokenization; admin view of payments.
- Changing country *after* a payment attempt started (takes effect next payment).

---

# Billing and Payments

Each user has a USD allowance. AI actions draw against it (see
[ai-usage.md](ai-usage.md)), and the Billing page is where the user sees what is
left and buys more. The payment provider is chosen by the user's country.

**Code:** `apps/cv-api/Features/Billing/`, `apps/ui-angular/src/app/features/billing/`
**See also:** [ai-usage.md](ai-usage.md) (how spend is metered and enforced)

---

## What a user sees

`/billing` shows the allowance, spend to date, remaining balance, currency, token
totals, and the stored payment country. Balance is `allowance − spend`, floored
at zero.

**Topping up.** Three fixed amounts: **$5, $10, $20**. A top-up needs a stored
country; if there is none, the UI asks for it with a searchable country select
before starting the payment, persists it, and never asks again. The country is
shown on the page and can be changed at any time before a payment.

**History.** Every top-up is listed newest first with its date, amount, channel,
and status (`Pending` / `Paid` / `Failed`).

Returning from the provider, the page reads `?topup=…&outcome=…`: `success` shows
a success banner and re-polls the summary until the webhook lands (the status may
briefly still be `Pending`); `cancelled` or `failure` shows a "payment didn't
complete" banner. The params are then stripped from the URL.

---

## Channel routing

| Country | Channel |
|---|---|
| `UA` | Monobank acquiring (invoice) |
| anything else | Stripe Checkout |

`PaymentChannelResolver.Resolve(country)` picks the channel; each channel
implements `IPaymentChannel.CreatePaymentAsync`, returning an external id and a
redirect URL. The chosen channel is recorded on the payment and shown in history.

- **Stripe** — a Checkout Session (`mode=payment`, one USD line item,
  `client_reference_id = paymentId`), with success/cancel URLs pointing back at
  `/billing`. `ExternalId` is the session id.
- **Monobank** — `POST /api/merchant/invoice/create` with an `X-Token` header,
  amount in kopecks at a **configured fixed** `UahPerUsd` rate (not a live FX
  lookup). `ExternalId` is the `invoiceId`. The balance is still credited in USD.
- **Fake channels** — when `Billing:Payments:UseFakeProviders` is true, both
  names resolve to fakes whose redirect is a local page at
  `GET /api/billing/fake-pay/{paymentId}` with Pay and Cancel buttons. They run
  the same confirmation code path as the real webhooks, so the whole flow is
  testable locally with no provider credentials. The fake endpoints 404 when the
  flag is off. It defaults to **false** and is enabled in
  `appsettings.Development.json`.

---

## Crediting rules

A payment is credited **only** on a `Pending → Paid` transition. A webhook for a
payment already `Paid` or `Failed` is acknowledged with `200` and ignored, so
provider retries and out-of-order deliveries never double-credit and terminal
statuses never regress.

On success: if the user already has a `BillingAccount`, add `AmountUsd` to it. If
not, create one with `AllowanceUsd = current effective allowance + AmountUsd` —
creating a zero-based row would silently erase the user's default allowance.

A cancelled, failed, or expired payment leaves allowance, spend, and balance
untouched. Blocked AI actions start working again as soon as the new allowance
exceeds accrued spend.

---

## API

All under `api/billing` and JWT-authenticated except the webhooks, which are
anonymous but signature-verified.

| Endpoint | Purpose |
|---|---|
| `GET /api/billing` | `{ allowanceUsd, spentUsd, balanceUsd, currency, promptTokens, completionTokens, cacheReadTokens, cacheWriteTokens, country }` |
| `PUT /api/billing/country` | `{ country }` → `204`. `400` unless a two-letter uppercase ISO 3166-1 alpha-2 code |
| `POST /api/billing/top-up` | `{ amountUsd }` → `{ paymentId, channel, redirectUrl }`. `400` amount not in {5,10,20} · `409` no country stored · `502` provider call failed |
| `GET /api/billing/top-ups` | Payment history, newest first |
| `POST /api/billing/webhooks/stripe` | Verifies `Stripe-Signature`; `checkout.session.completed` → Paid, `checkout.session.expired` → Failed; invalid signature → `400` |
| `POST /api/billing/webhooks/monobank` | Verifies the `X-Sign` ECDSA signature against Monobank's cached public key; `success` → Paid, `failure`/`expired`/`reversed` → Failed, `created`/`processing`/`hold` ignored |

---

## Data

`Users.Country` — nullable `varchar(2)`, ISO 3166-1 alpha-2 uppercase; `null`
means never asked.

`TopUpPayments` — `Id`, `UserId` (indexed FK), `AmountUsd`, `Channel`
(`stripe` | `monobank` | `fake-stripe` | `fake-monobank`), `Status`
(`Pending` | `Paid` | `Failed`), `ExternalId` (nullable, unique), `CreatedAt`,
`UpdatedAt`.

---

## Configuration

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

Real secrets live in .NET User Secrets locally and environment variables in
deployment — never in `appsettings.json`. See
[ADR-0002](../adr/0002-secret-management.md).

---

## Not implemented

Subscriptions or recurring payments, custom top-up amounts, refunds, receipts or
VAT handling, live FX rates for UAH, saved cards, an admin view of payments, and
changing country after a payment has started (it takes effect on the next one).

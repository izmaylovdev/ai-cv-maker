# User Stories — Billing & Payments

Paying for the product: topping up the AI billing balance through country-appropriate payment channels.

Builds on [ai-enhancement.md](ai-enhancement.md) US-AI-14 (per-user billing balance and enforcement), where adding funds was explicitly out of scope.

---

### US-BILL-1 — Top up my billing balance through a payment channel for my country

**As a** signed-in user whose AI balance is running low,
**I want to** buy additional credit from the Billing page, paying through a payment provider that works in my country,
**so that** I can keep using AI features without interruption no matter where I live.

**Depends on** US-AI-14: the balance shown there is what a successful top-up increases. The payment channel is chosen by the user's stored country (asked once, at first payment): Ukraine → Monobank acquiring (invoice), all other countries → Stripe Checkout.

**Acceptance criteria:**
- The Billing page (`/billing`) offers a **Top up** action with a choice of fixed amounts ($5 / $10 / $20).
- If I have no country saved yet, starting a top-up first asks me to pick my country from a list; after I confirm, the country is saved to my account and I am **not** asked again on later top-ups.
- My saved country is visible on the Billing page and I can change it there before a payment.
- Starting a top-up with country **Ukraine** takes me to a Monobank payment page; with any **other country** it takes me to a Stripe Checkout page. (In local/dev without provider keys, the app clearly routes to the correct channel even if the external page can't be completed.)
- After a payment is confirmed as successful, my allowance increases by exactly the paid amount, the Billing page shows the new balance and a higher allowance, and previously blocked AI actions work again.
- A cancelled or failed payment changes nothing: balance, allowance, and spend stay exactly as before, and the Billing page says the payment didn't complete.
- The Billing page lists my top-up history: date, amount, channel, and status (pending / paid / failed) for each attempt, newest first.
- Two users' top-ups are independent: one user paying does not change another user's balance, country, or history.
- All top-up and country endpoints require authentication; visiting `/billing` signed out still redirects to login.
- The top-up UI renders correctly in both light and dark themes.

---

# Architecture

## Overview

Applysy is a web application that lets users manage job profiles and generate AI-tailored CVs and cover letters as PDF files. The system is organized as an Nx monorepo with nine apps: a public marketing site (`landing`), the user-facing plane (`ui-angular`, `chat-ui`, `cv-api`, `llm-service`), the document-builder widget that is the canonical profile editor (`profile-builder-ui`, embedded in `ui-angular`; ADR-0013), an admin plane (`admin-api`, `admin-ui`), a Chrome extension (`chrome-extension`), and a monitoring stack (Prometheus + Grafana).

```
Browser ──────────────────────────────┐        Chrome extension (job auto-fill)
  └─ ui-angular (Angular 21 SPA)      │          └─ REST/HTTP ─────────┐
       └─ <ai-chat-widget>  ← chat-ui │                                │
            │                         ▼                                ▼
            └─ REST/HTTP ──→ cv-api (ASP.NET Core 9) ◄─────────────────┘
                                 ├─ Cloud Firestore (Native mode, app collections)
                                 └─ gRPC ──→ llm-service (Python, grpc.aio)
                                                  └─ LLM provider (Google, OpenAI-compat, Azure AI Foundry)

Admin browser
  └─ admin-ui (Next.js) ──→ admin-api (NestJS)
                               ├─ Cloud Firestore (same database, admin_users collection)
                               └─ REST/HTTP ──→ cv-api  (user list via /api/admin/users; API key)

Monitoring
  prometheus ── scrapes /metrics on cv-api + llm-service ──→ grafana (dashboards)

Nginx (ui-angular container)
  ├─ /api/*          → cv-api
  └─ /chat-widget/*  → chat-ui (Nginx serving chat-widget.js IIFE)
```

Both services share **one** Firestore database, separated by top-level collection
rather than by database, because the Firestore free tier covers exactly one
database per project ([ADR-0021](doc/adr/0021-firestore-replaces-cloud-sql.md)).
Networking topology and service isolation decisions are recorded in [ADR-0001](doc/adr/0001-llm-service-network-privacy.md).

---

## Shared Libraries

### `libs/auth` — `@applysy/auth`

Framework-agnostic TypeScript library used by `ui-angular` and `chat-ui`.

| Module | Purpose |
|---|---|
| `models` | `AuthRequest`, `AuthResponse`, `AuthSession`, `JwtPayload` interfaces |
| `constants` | `TOKEN_KEY` / `EMAIL_KEY` — single source of truth for localStorage keys |
| `storage` | `getToken()`, `getSession()`, `saveSession()`, `clearSession()` |
| `token` | `parseJwt()`, `isTokenExpired()`, `getTokenExpiry()` — client-side JWT decode |
| `api` | `loginApi()`, `registerApi()`, `googleLoginApi()` — plain `fetch` wrappers |
| `broadcast` | `createAuthBroadcast()` — cross-tab logout sync via `BroadcastChannel` |

Import path: `@applysy/auth` (path alias registered in `tsconfig.base.json`, picked up automatically by `nxViteTsPaths()` in Vite apps and the Angular compiler via tsconfig extends).

See [`libs/auth/README.md`](libs/auth/README.md) for usage examples and design rationale.

---

## Authentication Flow

```
User submits credentials
        │
        ▼
  loginApi() / registerApi() / googleLoginApi()   ← @applysy/auth
        │  POST /api/auth/{login|register|google}
        ▼
    cv-api validates → issues HS256 JWT (1-hour expiry)
                     → sets HttpOnly refresh token cookie (30-day, SHA-256 hashed at rest)
        │
        ▼
  saveSession(token, email)   ← @applysy/auth
  writes to localStorage['cv_token'] + ['cv_email']
        │
        └─ ui-angular: AuthService.isLoggedIn signal → authGuard allows routing
                        apiInterceptor reads getToken() → adds Authorization header

On 401 (access token expired):
  apiInterceptor → POST /api/auth/refresh (sends HttpOnly cookie automatically)
                 → cv-api rotates refresh token → returns new JWT
                 → interceptor retries original request with new token
                 → if refresh fails → forceLogout()

On logout:
  POST /api/auth/logout → cv-api revokes the stored refresh token
  clearSession() → broadcast.notifyLogout() → all same-origin tabs dispatch logout
```

**Token storage:** Access token in localStorage; refresh token in HttpOnly cookie (set by `cv-api`).  
**Transport:** `Authorization: Bearer <token>` header on every API request. Refresh uses the cookie automatically (credentials: include).  
**Expiry:** 1-hour JWT access token + 30-day rotating HttpOnly refresh token. Refresh tokens are stored hashed (SHA-256) in the `refreshTokens` collection — the base64url form of the hash *is* the document id, so the refresh lookup is a single keyed read — and rotated on every use.  
**CORS:** Locked to specific front-end origins with `AllowCredentials` to support the HttpOnly cookie flow.

---

## Services

### `apps/landing` — Marketing Landing Page

A standalone public marketing site — a single self-contained `index.html` (inline CSS/JS, no framework) bundled by Vite and served as static files by Nginx. It is independent of the SPA: no auth, no API calls, its CTAs link out to the app. Served on port `4203` in dev (`npx nx serve landing`); the production image (`apps/landing/Dockerfile`) builds with `nx build landing` and ships the output behind Nginx.

---

### `apps/ui-angular` — Angular SPA

Angular 21 standalone-component application served by Nginx. The Nginx container uses `envsubst` to inject `CV_API_UPSTREAM` at runtime, forwarding `/api/*` to the backend — no CORS is needed in production.

**Routes**
| Path | Component | Guard |
|---|---|---|
| `/auth/login` | `LoginComponent` | — |
| `/auth/register` | `RegisterComponent` | — |
| `/job-profiles` | `JobProfilesComponent` | `authGuard` |
| `/job-profiles/:id` | `ProfileComponent` (hosts `<applysy-profile-builder>`) | `authGuard` |
| `/job-profiles/:id/pdf` | `PdfPreviewPageComponent` | `authGuard` |
| `/chat` | `ChatPageComponent` (hosts `<ai-chat-widget>`) | `authGuard` |
| `/settings` | `SettingsComponent` (global AI preferences) | `authGuard` |
| `/billing` | `BillingComponent` (per-user $ balance, allowance & spend, US-AI-14; top-up with country-based payment channel, payment country, top-up history, US-BILL-1) | `authGuard` |

**Key features**
- Document-style profile editing via the embedded `<applysy-profile-builder>` web component (ADR-0013). `ProfileComponent` lazy-loads the widget (`BuilderLoaderService`, mirroring `ChatLoaderService`), seeds it with the profile's `document`, listens to `documentchange`, and wires Save / Import-from-CV / Open-PDF. Whole-document AI rewrites are now driven through the in-editor AI chat (US-AI-9) rather than a dedicated toolbar button. The chat lives in a collapsible sidebar that slides in from the right and pushes the editor on large screens (US-AI-10); it stays mounted while hidden so the thread and live document binding survive open/close, and its open/closed state persists in `localStorage`. The old reactive-form split-panel editor and its structured `Profile` model are removed.
- In-editor AI editing (US-AI-9): `ProfileComponent` also embeds `<ai-chat-widget>` (via `ChatLoaderService`), keeps its `.document` synced to the live (possibly unsaved) document, and on the widget's `edit` event calls `builder.applyEdit(patchJson)`. Rejected/invalid edits are surfaced back into the chat thread via the widget's `addAssistantNote(...)`; nothing is persisted until the user Saves.
- Inline PDF preview (`PdfPreviewComponent` wraps a blob URL in an `<iframe>`); the profile page posts the current `{ name, document }` to `/api/cvs/draft-pdf`
- Theme service (dark/light)

---

### `apps/chat-ui` — AI Chat Widget (React Web Component)

A self-contained React chat interface packaged as a [Custom Element](https://developer.mozilla.org/en-US/docs/Web/API/Web_components/Using_custom_elements) (`<ai-chat-widget>`). It is **not a standalone SPA** — it is built as a single IIFE JavaScript file and embedded inside `ui-angular`.

**Build output**

Vite builds the entire app — React, CSS, and all — into one file:

```
dist/apps/chat-ui/chat-widget.js   ← self-contained IIFE (~110 kB gzipped)
```

CSS is injected at runtime by `vite-plugin-css-injected-by-js`, so the single script file is fully standalone with no separate stylesheet.

**How it is loaded**

`ChatLoaderService` (in `ui-angular`) lazily injects a `<script>` tag into `<head>` the first time the Chat page is visited:

```
User navigates to /chat
  → ChatLoaderService.load()
  → <script src="/chat-widget/chat-widget.js"> injected into <head>
  → customElements.whenDefined('ai-chat-widget') resolves
  → ChatPageComponent renders <ai-chat-widget auth-token="…" api-base="…">
```

The promise is cached — subsequent navigations to the Chat page reuse the already-loaded element.

**Auth**

The widget has no auth of its own. `ChatPageComponent` passes the current JWT as an HTML attribute:

```html
<ai-chat-widget
  auth-token="eyJ..."
  api-base="https://…/api">
</ai-chat-widget>
```

`ChatApp` reads `authToken` from the attribute and adds it as an `Authorization: Bearer` header on every `POST /api/chat` request. The token is sourced from `AuthService.getToken()` in Angular — which in turn reads from `@applysy/auth`'s `getToken()`.

**API**

| Method | Endpoint | Body | Purpose |
|---|---|---|---|
| `POST` | `/api/chat` | `{ message, history[], document? \| jobContext? }` | Send a message; receive `{ reply, proposal? }` |

`history` is the in-memory conversation array (filtered to `user`/`assistant` roles), sent with every request so `cv-api` can forward full context to the LLM.

The same widget serves three modes, switched by which optional context is present:
- **Global assistant** (the `/chat` page) sends neither → `cv-api` answers from profile *summaries* (read-only, `UserChat`).
- **In-editor editor** (embedded in `ProfileComponent`, see below) sends the open profile `document` as context (US-AI-9) → `cv-api` routes to the per-profile `Chat` agent, which may return a `proposal` (`{ type: "edit", description, patchJson }`). The widget raises an `edit` CustomEvent; the host applies the patch live to `<applysy-profile-builder>` (unsaved) and never persists — the normal Save flow does. The patch is an ordered op list (`convertNode`/`setAttrs`/`addChild`/`removeNode`/`updateHeader`) addressed by `BlockNode.id`, applied and schema-validated by `applyPatch` in `profile-builder-ui/src/model.ts`. `cv-api` also passes the user's other saved profiles down in the `Chat` request; the agent can *read* them on demand via `list_profiles` / `get_profile` tools when a request references another profile (US-AI-13), but edits still target only the open document.
- **Job chat** (the `chrome-extension` side panel, US-EXT-4) sends `jobContext` (`{ jobTitle, jobDescription, fieldContext }` scraped from the active page) → `cv-api` routes to `JobChat` (profile summaries + the posting). A cover-letter request returns a `proposal` (`{ type: "fill", description, text }`); the widget renders the draft in-thread with a **"Use this"** action that raises a `fill` CustomEvent (`{ text }`), which the panel writes into the page field. Mutually exclusive with `document`.

**Components**

| Component | File | Role |
|---|---|---|
| `ChatApp` | `src/ChatApp.tsx` | Root — owns message state, calls the API, renders the layout |
| `MessageList` | `src/components/MessageList.tsx` | Renders the conversation; assistant replies are rendered as sanitized Markdown (`react-markdown` + `remark-gfm`), user/error messages as plain text with line breaks preserved; shows an empty-state prompt when no messages exist |
| `MessageInput` | `src/components/MessageInput.tsx` | Auto-growing textarea + Send button; `Enter` submits, `Shift+Enter` inserts a newline |

**Local development**

```sh
npm run serve:chat   # starts Vite dev server on port 4202 (wraps npx nx run chat-ui:dev)
```

A custom Vite plugin (`widgetDevBundlePlugin`) intercepts `GET /chat-widget.js` and returns an on-demand esbuild IIFE bundle. This means the Angular dev server (`port 4200`) can load the widget from `http://localhost:4202/chat-widget.js` without a separate production build step.

**Deployment**

The widget is served from its own Nginx Docker container. Angular's Nginx proxies `/chat-widget/*` to this container via `CHAT_UI_UPSTREAM`:

```
Browser → ui-angular Nginx → /chat-widget/* → chat-ui Nginx → chat-widget.js
```

---

### `apps/profile-builder-ui` — Document Builder Widget (React Web Component)

The **document-style profile editor** packaged — like `chat-ui` — as a self-contained React [Custom Element](https://developer.mozilla.org/en-US/docs/Web/API/Web_components/Using_custom_elements) (`<applysy-profile-builder>`), built as a single IIFE with CSS injected at runtime. It is **not a standalone SPA** and Angular remains the sole production SPA. Per ADR-0013 it is the **canonical profile editor**, embedded in `ui-angular` at `/job-profiles/:id` (it replaced the old structured split-panel editor).

Instead of fixed personal-info/experience/education/skills forms, the profile is edited as **one rich-text document** in a single Lexical editor built from a **closed set of predefined widgets** (ADR-0014, §13 / US-EDIT-19): **title** (a section heading that anchors a group), **text** (paragraph), **chips** (tag cloud), **list** (bullets), **link** (a standalone hyperlink line — spec §10), and **timeline** (dated entries — work experience, education, projects — each with Title / Dates / Description). Widgets are inserted from a fixed **controls side rail** beside the document. A **title** node anchors a *group*: dragging its handle moves the title plus all non-title blocks that follow it (until the next title or the end of the document) as a single unit, with a live drag preview and drop indicator.

**Model.** The widget operates on the `ProfileDocument` model (`apps/profile-builder-ui/src/model.ts`), the canonical persisted shape end to end: `{ header, body }`, where `body` is a **flat `BlockNode` tree** (`{ type, id, attrs?, children? }`, closed type set: root/**title**/paragraph/text/**inlineLink**/link/list/listItem/chips/chip/timeline/entry — `section` retired in US-EDIT-19; `inlineLink` is an inline hyperlink run inside paragraph text, added in US-EDIT-21, distinct from the standalone block `link` line). It is editor-independent: Lexical's own JSON is never persisted; a serialization layer (`serialize.ts`) maps the editor state ⇄ the neutral tree, and migrates any legacy `section` nodes to `title + flat children` on load. The cv-api stores `{ header, body }` as a single JSON string field on the profile document and `GET/PUT /api/job-profiles/:id` speak `{ id, name, document }`.

**Host-agnostic I/O** — no `fetch`, auth, or routing inside the widget:

| Channel | Direction | Detail |
|---|---|---|
| `document` attribute (JSON) / `.document` property (object) | host → widget | Seed the document |
| `documentchange` `CustomEvent` (`detail` = current `ProfileDocument`) | widget → host | Emitted on every edit |

The `ProfileBuilder` React component also exposes a plain `{ document, onChange }` props interface for direct use in tests and the dev harness.

**Build output**

```
dist/apps/profile-builder-ui/profile-builder.js   ← self-contained IIFE (~64 kB gzipped)
```

**Local development**

```sh
npm run serve:builder   # Vite dev server on port 4203 (wraps npx nx run profile-builder-ui:dev)
```

The dev server also serves the IIFE bundle at `GET /profile-builder.js` (an on-demand esbuild build, mirroring `chat-ui`'s `/chat-widget.js`), which is how `ui-angular` loads the widget in development (`environment.builderWidgetUrl` → `http://localhost:4203/profile-builder.js`; production serves it from `/profile-builder/profile-builder.js`). `apps/profile-builder-ui/index.html` separately mounts the widget seeded with a sample document for standalone UX work, using the shared `@applysy/dev-shell` harness (`src/dev-shell.ts`).

---

### `apps/cv-api` — REST API (ASP.NET Core 9)

The central backend. Exposes a JSON REST API, owns the database, generates PDFs, and orchestrates all LLM calls via gRPC.

**Controllers**

| Route | Controller | Purpose |
|---|---|---|
| `POST /api/auth/register` | `AuthController` | Email/password registration |
| `POST /api/auth/login` | `AuthController` | Email/password login → JWT + HttpOnly refresh cookie |
| `POST /api/auth/google` | `AuthController` | Google One-Tap login (ID-token credential) |
| `POST /api/auth/google/token` | `AuthController` | Google access-token login (Chrome extension via `chrome.identity`) |
| `POST /api/auth/google/code` | `AuthController` | Google authorization-code login |
| `POST /api/auth/refresh` | `AuthController` | Rotate refresh token → new JWT |
| `POST /api/auth/logout` | `AuthController` | Revoke refresh token in DB + clear cookie |
| `GET /api/job-profiles` | `JobProfileController` | List profiles for current user |
| `POST /api/job-profiles` | `JobProfileController` | Create profile |
| `GET /api/job-profiles/:id` | `JobProfileController` | Get full profile → `{ id, name, document }` (ADR-0013) |
| `PUT /api/job-profiles/:id` | `JobProfileController` | Replace profile content (`{ name, document }`) |
| `PATCH /api/job-profiles/:id` | `JobProfileController` | Rename profile (`{ name }` only — never touches the document; US-PROF-7) |
| `DELETE /api/job-profiles/:id` | `JobProfileController` | Delete profile |
| `POST /api/job-profiles/:id/chat` | `JobProfileController` | Profile-scoped AI chat against the **saved** document (reply + optional patch proposal). Not used by the in-editor chat, which sends the live document to `/api/chat` (US-AI-9); retained for callers that want to edit by stored profile id |
| `POST /api/job-profiles/:id/extract` | `JobProfileController` | Import profile from CV file (PDF/text, ≤10 MB) → `{ name, document }`; `name` is an LLM-suggested role label from the CV when derivable, else the profile's current name (US-PROF-8) |
| `GET /api/job-profiles/:id/cvs` | `CvController` | List generated CVs |
| `POST /api/job-profiles/:id/cvs` | `CvController` | Generate new tailored CV via LLM |
| `GET /api/job-profiles/:id/cvs/:cvId/pdf` | `CvController` | Download generated CV as PDF |
| `GET /api/job-profiles/:id/cvs/default/pdf` | `CvController` | Download raw (non-LLM) profile as PDF |
| `DELETE /api/job-profiles/:id/cvs/:cvId` | `CvController` | Delete generated CV |
| `POST /api/cvs/generate-auto` | `CvController` | LLM selects best profile then generates CV |
| `POST /api/cvs/draft-pdf` | `CvController` | Render an unsaved profile draft as PDF (live preview) |
| `POST /api/chat` | `ChatController` | AI chat for `<ai-chat-widget>`. Without `document`/`jobContext`: account-wide assistant over profile summaries (can update `GlobalPreferences`). With `document` (in-editor edit mode, US-AI-9): per-profile `Chat` agent returning `{ reply, proposal? }` (live/unsaved document, nothing persisted). With `jobContext` (extension side panel, US-EXT-4): `JobChat` agent over profile summaries + the page's posting, returning `{ reply, proposal? }` where a `fill` proposal carries a cover-letter draft |
| `POST /api/cover-letter` | `CoverLetterController` | Generate cover letter from job description (auto-selects profile) |
| `GET /api/settings/preferences` | `SettingsController` | Read user's global AI preferences |
| `PUT /api/settings/preferences` | `SettingsController` | Update global AI preferences |
| `GET /api/billing` | `BillingController` | Current user's per-user billing balance: `{ allowanceUsd, spentUsd, balanceUsd, currency, promptTokens, completionTokens, country }` where `balanceUsd = max(0, allowance − spent)` (US-AI-14; `country` added by US-BILL-1, `null` until asked) |
| `PUT /api/billing/country` | `BillingController` | Set the user's payment country (`{ country: "UA" }`, ISO alpha-2 uppercase; 400 otherwise) — selects the payment channel (US-BILL-1) |
| `POST /api/billing/top-up` | `BillingController` | Start a balance top-up (`{ amountUsd: 5\|10\|20 }`) → `{ paymentId, channel, redirectUrl }`. Routes by country: `UA` → Monobank invoice, else Stripe Checkout. 409 without a stored country, 502 on provider failure (US-BILL-1) |
| `GET /api/billing/top-ups` | `BillingController` | Current user's top-up history, newest first: `{ id, amountUsd, channel, status, createdAt }` (US-BILL-1) |
| `POST /api/billing/webhooks/stripe` | `BillingController` | Stripe webhook (anonymous, `Stripe-Signature`-verified): `checkout.session.completed` → Paid + credit, `checkout.session.expired` → Failed (US-BILL-1) |
| `POST /api/billing/webhooks/monobank` | `BillingController` | Monobank webhook (anonymous, `X-Sign` ECDSA-verified against the cached merchant pubkey): `success` → Paid + credit; `failure`/`expired`/`reversed` → Failed; intermediate statuses ignored (US-BILL-1) |
| `GET\|POST /api/billing/fake-pay/…` | `FakePayEndpoints` | **Dev only** (`Billing:Payments:UseFakeProviders`): local fake payment page + completion endpoint driving the same confirmation path as the webhooks; 404 in production mode (US-BILL-1) |
| `GET /api/admin/users` | `AdminUsersController` | Registered-users list for admin-api (service-to-service, API-key auth, **not** JWT) |
| `GET /api/admin/usage-limit` | `AdminUsageLimitController` | Read the global per-user spending limit (service-to-service, API-key auth) |
| `PUT /api/admin/usage-limit` | `AdminUsageLimitController` | Update the global per-user spending limit (service-to-service, API-key auth) |

**Services**
- `AuthService` — password hashing (BCrypt), JWT issuance, Google token/code verification, refresh-token rotation
- `JobProfileService`, `CvService`, `CoverLetterService`, `UsageService` — per-feature application logic (under `Features/`)
- `LlmService` — gRPC client to `llm-service`; wraps all LLM RPCs (`Generate`, `ExtractProfile`, `Chat`, `UserChat`, `JobChat`, `GenerateCoverLetter`, `SelectBestProfile`) with Polly circuit-breaker and rate-limit handling
- **Per-user billing balance (US-AI-14, extends US-AI-7)** — `UsageService.EnsureWithinLimitAsync` runs before every LLM RPC and throws `UsageLimitExceededException` once a user's accrued estimated cost reaches **that user's own allowance**; `UsageLimitExceptionHandler` maps it to **HTTP 402** with `{ code: "usage_limit_exceeded", message, limitUsd }` (the message reads as billing-balance exhaustion). The effective allowance resolves per user: the user's `BillingAccount.AllowanceUsd` if a row exists, else the nullable `Billing:DefaultAllowanceUsd` config, else the §9 global limit (`LlmUsageLimitUsd` row in `AppSettings` → `UsageLimit:MaxCostUsdPerUser`, default `$0.50`). Leaving `Billing:DefaultAllowanceUsd` unset preserves the admin-configurable global cap for users without a `BillingAccount` row. `GET /api/billing` surfaces the derived balance (`BillingSummaryDto`).
- **Balance top-up via country-based payment channels (US-BILL-1)** — `TopUpService` + `IPaymentChannel` implementations under `Features/Billing/Channels/`. `PaymentChannelResolver` picks the channel from `User.Country` (asked once, at first payment): `UA` → `MonobankChannel` (invoice/create, amount in kopecks at the fixed configured `Billing:Payments:Monobank:UahPerUsd` rate), anything else → `StripeChannel` (Stripe.net Checkout Session). Payment confirmations (Stripe webhook, Monobank webhook, and the dev fake-pay endpoints) all funnel through one idempotent `PaymentConfirmationService`: only a `Pending → Paid` transition credits `BillingAccount.AllowanceUsd`, so provider retries can't double-credit. When `Billing:Payments:UseFakeProviders` is true (Development default), fake channels + a local fake payment page replace the real providers so the whole flow runs without credentials.
- `PdfService` — renders a `ProfileDocument` to PDF using QuestPDF (A4); walks `header` + the `body` block tree generically (ADR-0014)

**Request tracing — OpenTelemetry + Tempo ([ADR-0016](doc/adr/0016-distributed-tracing-tempo-otel.md))**
cv-api is instrumented with OpenTelemetry (ASP.NET Core + gRPC-client) and exports spans over OTLP to Grafana Tempo. The gRPC client injects the W3C `traceparent` into call metadata, so the trace propagates to llm-service and the whole request renders as one cross-service waterfall in Grafana (HTTP → gRPC → llm-service handler → LLM call). Tracing is **opt-in and no-op when unconfigured** — it activates only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set (the docker-compose stack points it at `http://tempo:4317`). This replaced the former `RequestSpans` Postgres table and `RequestTracingMiddleware`, which only stored flat, un-nested rows.

**PDF generation**  
`PdfService.GenerateFromDocument(ProfileDocument)` renders the document generically (ADR-0014): the `header` (name, title, contacts) followed by a **recursive walk of the `body` block tree** — one handler per node type (section → heading + flow, paragraph → text with inline-link hyperlinks, link → a hyperlink line, list → bullets with indentation for nesting, chips → tag cloud, timeline → entries with title / dates / description). User-created sections (Projects, Publications, …) and nested widgets flow to the PDF without code changes; unknown or empty nodes degrade gracefully and depth is bounded. cv-api renders the document for both saved profiles and unsaved drafts (`POST /api/cvs/draft-pdf`).

---



### `apps/llm-service` — LLM Gateway (Python / gRPC)

A thin async service exposing LLM operations over gRPC only. `app/main.py` runs a pure `grpc.aio` server (port `GRPC_PORT`, default 8080) plus a Prometheus metrics HTTP endpoint (`prometheus_client.start_http_server`, port `METRICS_PORT`, default 9090). There is no FastAPI/HTTP API anymore; `cv-api` is the sole consumer, over gRPC, in all environments. A standard gRPC health servicer (async) answers Cloud Run health checks.

**Operations** (implemented in `app/grpc/servicer.py`, prompt chains in `app/chains/`)
| Operation | Description |
|---|---|
| `Generate` | Takes a profile document + optional notes → returns a tailored `ProfileDocument` (ADR-0013) |
| `ExtractProfile` | Takes raw CV text → returns a `ProfileDocument` (header + a `body` block tree inferred from the CV) plus a `profile_name` — an LLM-suggested role label for the profile (US-PROF-8, `""` if none derivable) |
| `Chat` | Profile-scoped conversational assistant; may read the user's other saved profiles on demand via `list_profiles` / `get_profile` tools (US-AI-13) |
| `UserChat` | Account-wide chat over profile summaries; may return a `PreferencesUpdate` that cv-api persists to `User.GlobalPreferences` |
| `JobChat` | Side-panel chat over profile summaries + an open job posting (US-EXT-4); answers questions or returns a `fill` proposal carrying a cover-letter draft |
| `GenerateCoverLetter` | Job description (+ selected/auto profile) → cover-letter text, styled as a direct application message for a form field rather than a formal letter (US-EXT-5) |
| `SelectBestProfile` | Job description + profile summaries → best-matching profile id |
| `Health` | Liveness check |

**LLM provider switching**  
Controlled entirely by environment variables — no code changes required:

| `LLM_PROVIDER` | Model variable | Notes |
|---|---|---|
| `google` (default) | `LLM_MODEL` or `gemini-1.5-flash` | Requires `GOOGLE_API_KEY` |
| `openai` | `OPENAI_MODEL` | Any OpenAI-compatible endpoint; default points to LM Studio on localhost |
| `foundry` | `FOUNDRY_DEPLOYMENT_NAME` / `LLM_MODEL` | Azure AI Foundry (e.g., Claude via Anthropic); requires `FOUNDRY_API_KEY` |

**LLM observability — Langfuse ([ADR-0010](doc/adr/0010-langfuse-llm-observability.md))**
All model calls in llm-service are traced to a self-hosted Langfuse when configured. Both invocation paths are instrumented through `app/observability.py`: the LangChain path (google/openai/azure) via a `CallbackHandler`, and the direct Anthropic path (anthropic/foundry) via a generation span recording model + token usage (including `cache_read_input_tokens` / `cache_creation_input_tokens` once prompt caching engages — US-AI-17, [ADR-0019](doc/adr/0019-anthropic-prompt-caching.md)). A gRPC server interceptor (`app/grpc/trace_interceptor.py`) opens the root trace per RPC.

Tracing is **opt-in and no-op when unconfigured** — it activates only when all three vars are set:

| Env var | Notes |
|---|---|
| `LANGFUSE_PUBLIC_KEY` | `pk-...`; absence of any of the three disables tracing entirely |
| `LANGFUSE_SECRET_KEY` | `sk-...` (Secret Manager in prod, [ADR-0002](doc/adr/0002-secret-management.md)) |
| `LANGFUSE_HOST` | Langfuse base URL (self-hosted). In prod, the internal IP of the Langfuse VM ([ADR-0011](doc/adr/0011-langfuse-prod-single-vm.md)) |

cv-api propagates request correlation context to llm-service as gRPC metadata — `x-trace-id` (the active OpenTelemetry trace id, [ADR-0016](doc/adr/0016-distributed-tracing-tempo-otel.md)), `x-user-id` (authenticated user), and `x-session-id` (the chat widget's per-conversation id, US-AI-16). llm-service maps the trace id deterministically (`Langfuse.create_trace_id(seed=...)`), sets `user_id`, and sets `session_id` from `x-session-id`, so each Langfuse trace correlates with the Tempo trace for the same request and all messages of one chat conversation group under a single Langfuse **Session**. The chat widget (`chat-ui`) mints one session id per mount and sends it on every `POST /api/chat`; a page reload starts a new conversation → a new Session. A missing session id is a no-op (trace produced without a session). The OpenTelemetry gRPC **server** interceptor (added in `app/main.py`) separately extracts the W3C `traceparent` so llm-service's spans nest under the cv-api trace in Tempo. Locally, bring up Langfuse with the opt-in overlay: `docker compose -f docker-compose.yml -f docker-compose.langfuse.yml up` (UI at `http://localhost:3030`).

**LLM evals — Langfuse datasets + experiments ([ADR-0012](doc/adr/0012-langfuse-evals.md))**
Offline evals live in `apps/llm-service/evals/`. Fixtures (`evals/fixtures/*.jsonl`) are the version-controlled source of truth; each run upserts them into a Langfuse dataset named `eval-<operation>` and runs an experiment (`Langfuse.run_experiment`) over the items. Targets (`evals/targets.py`) call each LLM operation; evaluators (`evals/evaluators.py`) emit `Evaluation` scores — deterministic extraction-accuracy checks plus Claude-as-judge quality/on-task/preference-adherence scorers. Each score carries a rationale `comment` (the judge's reasoning, or the deterministic expected-vs-got detail) and `{operation, model}` metadata, so the Langfuse scores table is self-explanatory rather than bare numbers; the dataset-run view is the per-item lens. Each operation's run is tagged with the Langfuse tracing environment `eval-<operation>`, so the scores/traces **Environment** column (sortable and filterable) shows which operation a score belongs to. Aggregate scores are checked against per-operation thresholds and the process exits non-zero on a breach (CI quality gate); results are also written to `evals/results/<operation>_latest.json` and viewable in the Langfuse UI. Running evals **requires** the `LANGFUSE_*` credentials (unlike live tracing, which is opt-in/no-op). Locally, start the Langfuse overlay and run `npm run evals` (the `llm-service:evals` Nx target injects the overlay's local-dev keys; bare run = all operations, forward args via `npm run evals -- --operation extract` or `-- --sync-only`). Against a non-local Langfuse, set `LANGFUSE_*` and call the module directly: `cd apps/llm-service && python -m evals.run_evals --operation all`.

---

### `apps/admin-api` + `apps/admin-ui` — Admin Plane

A separate admin panel for operating the product, isolated from the user-facing plane.

| App | Stack | Role |
|---|---|---|
| `admin-api` | NestJS (global prefix `/api`, port 3000) | Admin backend: admin login (`POST /api/auth/google`, `POST /api/auth/login`), registered-users list (`GET /api/users`) |
| `admin-ui` | Next.js | Admin frontend; calls `admin-api` (`ADMIN_API_URL`) and embeds Grafana dashboards (`GRAFANA_URL`) |

`admin-api` owns **one** collection — `admin_users`, holding admin accounts, on the same Firestore database cv-api uses (ADR-0021). It does **not** read or write any of cv-api's collections; the separation is by collection name and by convention, since Firestore IAM has no collection-level granularity. Documents keep the old Postgres column names verbatim (`email`, `password_hash`, `google_id`, `created_at`) and the document id is the admin's UUID. There is no schema to create: `apps/admin-api/src/migrate.ts` now only seeds the first operator from `ADMIN_SEED_EMAIL`, and it is run deliberately rather than at boot. For user data it calls cv-api's `GET /api/admin/users` over HTTP (`CV_API_URL`), authenticated with a shared API key (`CV_API_ADMIN_KEY`) that cv-api validates against `AdminApi:ApiKey` — cv-api is the sole owner of the `Users`/`Profiles` schema ([ADR-0005](doc/adr/0005-admin-api-via-cv-api.md), superseding [ADR-0004](doc/adr/0004-admin-api-main-db-access.md)). The same pattern carries the per-user spending limit: admin-ui → admin-api `GET/PUT /api/usage-limit` → cv-api `GET/PUT /api/admin/usage-limit`, exposed in admin-ui at `/settings` (US-AI-7). Domain docs: [`doc/admin/`](doc/admin/).

---

### `apps/chrome-extension` — Job Application Auto-Fill (Chrome MV3)

A Manifest V3 extension ("Applysy — Job Fill", TypeScript + Vite, React side panel) that fills job-application forms using the user's profiles. It is a pure client of `cv-api` — no backend of its own.

- **Side panel** (toolbar icon, US-EXT-4; tab-scoped per US-EXT-7) — opens a chat (`<ai-chat-widget>`, the bundled `chat-ui` IIFE) seeded with the active page's job posting as `jobContext`. The user asks about the role and requests a cover letter; the draft appears in-thread with a "Use this" action that writes it into the page field (via the content script's existing `INSERT_TEXT` path). A tiny router hosts the chat (default), a Settings view (optimised-CV profile picker), and a Hotkeys view. The background script relays `PANEL_GET_PAGE_CONTEXT`/`PANEL_INSERT_TEXT` between the panel and the active tab. The panel is enabled per tab (`sidePanel.setOptions({ tabId })` on invocation — no manifest `default_path`), so it appears only on tabs where the user invoked it instead of following them across the window.
- `Alt+Shift+F` — content script heuristically detects cover-letter/free-text fields on the page and fills them via `POST /api/cover-letter` (the backend auto-selects the best profile). The content script is injected on demand (`chrome.scripting.executeScript` from the background, US-EXT-7) — there is no declarative `content_scripts` entry, so no extension code runs on pages where the extension was never invoked.
- `Alt+Shift+D` — generates and downloads an optimized CV PDF for the current job posting (`POST /api/cvs/generate-auto`, or `POST /api/job-profiles/:id/cvs` + PDF download when a specific profile is selected in Settings)
- Auth: Google sign-in via `chrome.identity` → `POST /api/auth/google/token`, or email/password login; the JWT is stored in `chrome.storage.local` under the shared `TOKEN_KEY` constant from `@applysy/auth`

Domain docs: [`doc/chrome-extension/`](doc/chrome-extension/).

---

## Data Model

Firestore (Native mode), one database shared by cv-api and admin-api
([ADR-0021](doc/adr/0021-firestore-replaces-cloud-sql.md)). Nesting follows **the
key a document is looked up by**, not the old relational foreign key: only
`Profile` and `BillingAccount` are ever reached with the user id already in hand,
so only those are subcollections. The rest stay top-level, where their hottest
lookup is a keyed read rather than a collection-group query needing its own index.

```
users/{userId}                        — cv-api
 ├── email (unique by convention — Firestore has no unique constraint)
 ├── passwordHash (nullable)
 ├── googleId (nullable)
 ├── createdAt
 ├── globalPreferences  — nullable free-text AI preferences (edited on /settings or by the UserChat agent)
 └── country  — nullable ISO 3166-1 alpha-2 (uppercase), asked at first top-up; selects the payment channel

users/{userId}/profiles/{profileId}
 ├── name      — internal label (e.g. "Senior Dev Profile")
 └── document  — the canonical ProfileDocument { header, body } (ADR-0013, body a flat
                 BlockNode tree per ADR-0014), stored as a JSON string field.
                 Blank-created profiles seed ProfileDocument.DefaultTemplate(): an empty
                 header + four titled sections (Professional Summary / Work Experience /
                 Education / Skills) with empty scaffolding — structure only, no data.
                 Bootstrap-from-CV seeds from extracted data instead.

users/{userId}/billing/account        — exactly one document per user, fixed id "account",
 ├── allowanceUsd    so "does this user have a billing account?" is a keyed read, which is
 ├── currency        what the payment-confirmation transaction needs.
 └── updatedAt
       Absence of the document ⇒ fall back to Billing:DefaultAllowanceUsd, else the
       global limit. Balance is derived (allowance − accrued cost), never stored.

generatedCvs/{cvId}                   — top-level: CvService reaches a CV by (cvId, profileId)
 ├── profileId                          and never has the owning user in scope there
 ├── createdAt
 ├── fullName, title, location, contactEmail, contactPhone  — snapshot at generation time
 ├── optimizationNotes  — free-text hint passed to LLM
 └── cvDataJson  — serialized LlmGenerateResponse (summary, work, education, skills, highlights)

llmUsage/{id}                         — top-level: userId is nullable (system calls), and a
 ├── userId (nullable)                  subcollection has nowhere to put unattributed rows
 ├── operation  — "Generate" | "Extract" | "Chat" | "UserChat" | "JobChat" | "CoverLetter" | "GenerateAuto"
 ├── promptTokens, completionTokens
 ├── cacheReadTokens, cacheWriteTokens  — Anthropic prompt-cache counts (US-AI-17, ADR-0019)
 ├── modelName  — e.g. "claude-sonnet-4-6"
 └── createdAt (UTC)

refreshTokens/{base64urlTokenHash}    — the document id IS the SHA-256 hash of the cookie
 ├── userId                             value in base64url form (base64's "/" is illegal in a
 ├── token       — the unmodified base64 hash  Firestore id), making the hottest auth lookup a
 ├── expiresAt, createdAt               single keyed get with no query and no index
 └── isRevoked

topUpPayments/{paymentId}             — top-level: provider webhooks carry no user identity,
 ├── userId                             only the payment id or externalId
 ├── amountUsd  — one of the fixed amounts (5 / 10 / 20)
 ├── channel    — "stripe" | "monobank" (dev fake mode: "fake-stripe" | "fake-monobank")
 ├── status     — Pending → Paid | Failed (terminal statuses never regress)
 ├── externalId (nullable)  — Stripe Checkout session id / Monobank invoiceId
 └── createdAt, updatedAt (UTC)
       A Pending → Paid transition credits billing/account.allowanceUsd by amountUsd exactly
       once, inside a Firestore transaction, so provider retries cannot double-credit. First-ever
       credit seeds the billing account from the user's current effective allowance + amount.

appSettings/{key}                     — the document id IS the setting key, e.g.
 ├── value                              "LlmUsageLimitUsd" (per-user spending cap, US-AI-7)
 └── updatedAt (UTC)

admin_users/{id}                      — admin-api (see the admin plane section above)
 ├── email, password_hash (nullable), google_id (nullable)
 └── created_at
```

**What Firestore does not do for us.** There are no foreign keys, so cascade
deletes (profiles and top-up payments when a user goes, generated CVs when a
profile goes) are explicit recursive deletes in application code, and
referential integrity is a code invariant rather than a schema one. There are no
unique constraints, so uniqueness (user email, admin email, payment
`externalId`) is a writer-side invariant. Multi-field queries need composite
indexes, there are no joins, and reads are billed per document. Transactions are
capped at 500 writes.

Access is by service-account IAM (`roles/datastore.user`, granted per service in
`infra/firestore.tf`) — there is no database password anywhere. cv-api's
repositories live behind a persistence seam (`apps/cv-api/Domain/Repositories/`
interfaces, `apps/cv-api/Infrastructure/Persistence/Firestore/`
implementations), which is what lets the tests fake the store instead of a
database. There are no schema migrations: Firestore is schemaless, so schema
evolution is a code-level concern with no enforcement point. The one-off
Postgres→Firestore data move lives in `scripts/migrate-to-firestore/`.

Only cv-api reads or writes the application collections; admin-api reaches user
data through cv-api's `GET /api/admin/users`
([ADR-0005](doc/adr/0005-admin-api-via-cv-api.md)).

(Request tracing is not in the database — spans go to Grafana Tempo via
OpenTelemetry; see [ADR-0016](doc/adr/0016-distributed-tracing-tempo-otel.md).)

---

## gRPC Contract

Defined in `proto/llm_service.proto`. The C# stubs are generated at build time; the Python stubs are checked in under `apps/llm-service/app/grpc/`.

Eight RPC methods: `Generate`, `ExtractProfile`, `Chat`, `UserChat`, `JobChat`, `Health`, `GenerateCoverLetter`, `SelectBestProfile`.

The profile is carried as `ProfileDocumentProto` (`id` + `ProfileHeaderProto header` + a recursive `ProfileNode body` block tree, ADR-0014) — the wire mirror of the canonical `ProfileDocument`. `Generate`, `ExtractProfile`, `Chat`, and `SelectBestProfile` take and/or return documents (`Generate`/`ExtractProfile` responses are a `ProfileDocumentProto document`; `Chat` returns a reply + optional patch proposal). `ChatRequest` also carries `repeated OtherProfile other_profiles` — the user's other saved profiles the agent may read on demand via tools (US-AI-13). The proto's `ProfileDocumentProto` comment points to the TypeScript and C# definitions it must stay in sync with.

---

## Infrastructure (GCP)

Managed by Terraform in `infra/`. Services run on **Cloud Run v2**; images live in **Artifact Registry**; the database is **Cloud Firestore in Native mode** — the project's `(default)` database, the only free-tier-eligible one, defined in `infra/firestore.tf` ([ADR-0021](doc/adr/0021-firestore-replaces-cloud-sql.md)). The Cloud SQL Postgres instance it replaced is **stopped and retained** as a rollback target for one window (`infra/database.tf`, `activation_policy = "NEVER"`, both deletion guards on); nothing reads it. Public hostnames are served through **Cloudflare** (free plan, not in Terraform): Cloudflare terminates TLS and a Worker (`infra/cloudflare/`) does host-based routing to the `run.app` origins — `applysy.works` / `www.applysy.works` → landing, `app.applysy.works` → ui-angular, `admin.applysy.works` → admin-ui ([ADR-0020](doc/adr/0020-cloudflare-worker-replaces-lb.md); it replaced the global HTTPS load balancer of [ADR-0007](doc/adr/0007-landing-page-deployment.md)).

| Cloud Run service | Instances | Ingress | Invoker | VPC egress |
|---|---|---|---|---|
| `llm-service` | 0–2 | Internal only | cv-api SA only | none (direct internet to LLM providers) |
| `cv-api` | 1–2 | All | `allUsers` (public API) | ALL_TRAFFIC |
| `chat-ui` | 0–2 | Internal only | `allUsers` | none |
| `landing` | 0–2 | All | `allUsers` | none |
| `ui-angular` | 0–2 | All | `allUsers` | ALL_TRAFFIC |
| `prometheus` | 1 | Internal only | — | none |
| `grafana` | — | All | `allUsers` | ALL_TRAFFIC |
| `admin-api` | 0–2 | Internal only | — | ALL_TRAFFIC |
| `admin-ui` | 0–2 | All | `allUsers` | ALL_TRAFFIC |

**LLM observability — Langfuse VM ([ADR-0011](doc/adr/0011-langfuse-prod-single-vm.md)):** the self-hosted Langfuse stack (web + worker + ClickHouse + Redis + MinIO) is defined to run as a docker-compose deployment on a **single `e2-small` GCE VM** (`infra/langfuse.tf`), the cheapest hosting option. The whole stack is **gated behind `var.langfuse_enabled` (default `false`)** — committed and validated but not yet deployed; flip the flag to provision it. Langfuse hard-requires Postgres and cannot run on Firestore, so since ADR-0021 its metadata DB is **not** provisioned by us: enabling Langfuse in production now means supplying an external Postgres via `langfuse_postgres_host` / `_user` / `_password` (a Neon free project would serve). ClickHouse/MinIO state lives on a separate persistent disk that survives VM re-creation. The VM has **no inbound internet access** (firewall allows the Langfuse port only from the Cloud Run egress subnet, plus IAP for SSH); its ephemeral external IP is outbound-only, for image pulls. `llm-service` reaches it at a static internal IP via Direct VPC egress (`PRIVATE_RANGES_ONLY`, which keeps its direct path to external LLM providers). The UI is reached by an IAP SSH tunnel (`terraform output langfuse_ssh`).

**Network privacy ([ADR-0001](doc/adr/0001-llm-service-network-privacy.md)):** llm-service is not reachable from the public internet. Cloud Run v2 treats CR-to-CR `.run.app` calls as external, so callers of internal-only services route egress through the project VPC (Direct VPC egress + Private Google Access). cv-api authenticates to llm-service with a Google-signed ID token (`LlmService__AuthMode=google`); IAM (`run.invoker`) enforces it at the edge. Firestore has **no public database surface at all** — it is a Google API reached over Private Google Access and authorised by IAM, so it needs no VPC path, no Cloud NAT and no authorized-networks list.

**Secret management ([ADR-0002](doc/adr/0002-secret-management.md)):** sensitive runtime values (JWT secrets, OAuth client secret, LLM API keys, Grafana password — no database credential remains, since Firestore is authorised by service-account IAM) live in **Secret Manager** (`infra/secrets.tf`) and reach Cloud Run via `secret_key_ref` env references — never plaintext env vars. Each secret grants `secretAccessor` only to the consuming service's runtime SA. Terraform state is remote in a versioned GCS bucket (`applysy-tf-state`).

---

## Local Development

`docker-compose.yml` mirrors the production topology, including the admin plane and monitoring stack:

| Service | Host port | Notes |
|---|---|---|
| `firestore` | 8085 | Firestore emulator (same port in and out). One instance serves cv-api **and** admin-api, mirroring production's single shared database. Wrapped by `scripts/firestore-emulator.sh` for the export-on-shutdown / import-on-start round trip that makes the `firestore_data` volume persistent |
| `cv-api` | 5050 | REST API (container 8080) |
| `ui-angular` | 4200 | Browser entry point; Nginx proxies `/api/*` → cv-api and `/chat-widget/*` → chat-ui |
| `chat-ui` | 4202 | Nginx serving the chat-widget bundle |
| `llm-service` | 50051 (gRPC), 8080 (metrics) | gRPC server + Prometheus metrics HTTP endpoint |
| `admin-api` | 3001 | NestJS admin backend (container 3000); uses the `admin_users` collection on the shared emulator and calls cv-api for user data |
| `admin-ui` | 3002 | Next.js admin frontend (container 3000) |
| `prometheus` | 9090 | Scrapes `/metrics` on cv-api and llm-service |
| `grafana` | 3000 | Dashboards provisioned from `monitoring/grafana/provisioning/` |

Both the .NET and Node Firestore SDKs route to the emulator purely on `FIRESTORE_EMULATOR_HOST` (`firestore:8085` in-network, `localhost:8085` for host-run dev servers) with `GOOGLE_CLOUD_PROJECT` namespacing the data — no credentials and no connection string are involved locally.

Set `LLM_PROVIDER=openai` and `OPENAI_BASE_URL=http://host.docker.internal:1234/v1` to target a local LM Studio instance instead of a cloud API.

The Langfuse overlay (`docker-compose.langfuse.yml`) carries **its own** Postgres — the only Postgres left in the repo — because Langfuse cannot run on Firestore.

---

## CI/CD

`.github/workflows/deploy.yml` builds and pushes images to Artifact Registry (auth via Workload Identity Federation) and deploys to Cloud Run on push to `main`. Images are deployed by **immutable git-SHA tag**, not `:latest` — every Cloud Run service carries `lifecycle { ignore_changes = [image] }` so Terraform owns config while CI owns the running image ([ADR-0003](doc/adr/0003-migrations-and-image-pinning.md)). There is **no migration step**: Firestore is schemaless, so the `cv-api-migrate` Cloud Run job is gone and ADR-0003's migration-as-a-deploy-step half no longer applies to cv-api (ADR-0021). See `DEPLOY.md` for the full from-scratch deployment guide.

# Architecture

## Overview

Applysy is a web application that lets users manage job profiles and generate AI-tailored CVs and cover letters as PDF files. The system is organized as an Nx monorepo with ten apps: a public marketing site (`landing`), the user-facing plane (`ui-angular`, `chat-ui`, `cv-api`, `llm-service`), the document-builder widget that is the canonical profile editor (`profile-builder-ui`, embedded in `ui-angular`; ADR-0013), an admin plane (`admin-api`, `admin-ui`), a Chrome extension (`chrome-extension`), and a monitoring stack (Prometheus + Grafana).

```
Browser ──────────────────────────────┐        Chrome extension (job auto-fill)
  └─ ui-angular (Angular 21 SPA)      │          └─ REST/HTTP ─────────┐
       └─ <ai-chat-widget>  ← chat-ui │                                │
            │                         ▼                                ▼
            └─ REST/HTTP ──→ cv-api (ASP.NET Core 8) ◄─────────────────┘
                                 ├─ PostgreSQL (EF Core, main DB)
                                 └─ gRPC ──→ llm-service (Python, grpc.aio)
                                                  └─ LLM provider (Google, OpenAI-compat, Azure AI Foundry)

Admin browser
  └─ admin-ui (Next.js) ──→ admin-api (NestJS)
                               ├─ admin DB (PostgreSQL — admin users/sessions)
                               └─ REST/HTTP ──→ cv-api  (user list via /api/admin/users; API key)

Monitoring
  prometheus ── scrapes /metrics on cv-api + llm-service ──→ grafana (dashboards; also queries main DB)

Nginx (ui-angular container)
  ├─ /api/*          → cv-api
  └─ /chat-widget/*  → chat-ui (Nginx serving chat-widget.js IIFE)
```

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
                     → sets HttpOnly refresh token cookie (30-day, SHA-256 hashed in DB)
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
  POST /api/auth/logout → cv-api revokes refresh token in DB
  clearSession() → broadcast.notifyLogout() → all same-origin tabs dispatch logout
```

**Token storage:** Access token in localStorage; refresh token in HttpOnly cookie (set by `cv-api`).  
**Transport:** `Authorization: Bearer <token>` header on every API request. Refresh uses the cookie automatically (credentials: include).  
**Expiry:** 1-hour JWT access token + 30-day rotating HttpOnly refresh token. Refresh tokens are stored hashed (SHA-256) in the `RefreshTokens` table and rotated on every use.  
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
| `/usage` | `UsageComponent` (token usage & cost) | `authGuard` |

**Key features**
- Document-style profile editing via the embedded `<applysy-profile-builder>` web component (ADR-0013). `ProfileComponent` lazy-loads the widget (`BuilderLoaderService`, mirroring `ChatLoaderService`), seeds it with the profile's `document`, listens to `documentchange`, and wires Save / Optimize / Import-from-CV / Open-PDF. The old reactive-form split-panel editor and its structured `Profile` model are removed.
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
| `POST` | `/api/chat` | `{ message, history[], document? }` | Send a message; receive `{ reply, proposal? }` |

`history` is the in-memory conversation array (filtered to `user`/`assistant` roles), sent with every request so `cv-api` can forward full context to the LLM.

The same widget serves two modes, switched by whether `document` is present (US-AI-9):
- **Global assistant** (the `/chat` page) omits `document` → `cv-api` answers from profile *summaries* (read-only, `UserChat`).
- **In-editor editor** (embedded in `ProfileComponent`, see below) sends the open profile `document` as context → `cv-api` routes to the per-profile `Chat` agent, which may return a `proposal` (`{ type, description, patchJson }`). The widget raises an `edit` CustomEvent; the host applies the patch live to `<applysy-profile-builder>` (unsaved) and never persists — the normal Save flow does. The patch is an ordered op list (`convertNode`/`setAttrs`/`addChild`/`removeNode`/`updateHeader`) addressed by `BlockNode.id`, applied and schema-validated by `applyPatch` in `profile-builder-ui/src/model.ts`.

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

**Model.** The widget operates on the `ProfileDocument` model (`apps/profile-builder-ui/src/model.ts`), the canonical persisted shape end to end: `{ header, body }`, where `body` is a **flat `BlockNode` tree** (`{ type, id, attrs?, children? }`, closed type set: root/**title**/paragraph/text/link/list/listItem/chips/chip/timeline/entry — `section` retired in US-EDIT-19). It is editor-independent: Lexical's own JSON is never persisted; a serialization layer (`serialize.ts`) maps the editor state ⇄ the neutral tree, and migrates any legacy `section` nodes to `title + flat children` on load. The cv-api stores `{ header, body }` as a JSON column and `GET/PUT /api/job-profiles/:id` speak `{ id, name, document }`.

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

### `apps/cv-api` — REST API (ASP.NET Core 8)

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
| `DELETE /api/job-profiles/:id` | `JobProfileController` | Delete profile |
| `POST /api/job-profiles/:id/optimize` | `JobProfileController` | AI-rewrite profile via LLM → `{ document }` |
| `POST /api/job-profiles/:id/chat` | `JobProfileController` | Profile-scoped AI chat against the **saved** document (reply + optional patch proposal). Not used by the in-editor chat, which sends the live document to `/api/chat` (US-AI-9); retained for callers that want to edit by stored profile id |
| `POST /api/job-profiles/:id/extract` | `JobProfileController` | Import profile from CV file (PDF/text, ≤10 MB) → `{ name, document }` |
| `GET /api/job-profiles/:id/cvs` | `CvController` | List generated CVs |
| `POST /api/job-profiles/:id/cvs` | `CvController` | Generate new tailored CV via LLM |
| `GET /api/job-profiles/:id/cvs/:cvId/pdf` | `CvController` | Download generated CV as PDF |
| `GET /api/job-profiles/:id/cvs/default/pdf` | `CvController` | Download raw (non-LLM) profile as PDF |
| `DELETE /api/job-profiles/:id/cvs/:cvId` | `CvController` | Delete generated CV |
| `POST /api/cvs/generate-auto` | `CvController` | LLM selects best profile then generates CV |
| `POST /api/cvs/draft-pdf` | `CvController` | Render an unsaved profile draft as PDF (live preview) |
| `POST /api/chat` | `ChatController` | AI chat for `<ai-chat-widget>`. Without `document`: account-wide assistant over profile summaries (can update `GlobalPreferences`). With `document` (in-editor edit mode, US-AI-9): per-profile `Chat` agent returning `{ reply, proposal? }`; the document is taken from the request (live/unsaved) and nothing is persisted |
| `POST /api/cover-letter` | `CoverLetterController` | Generate cover letter from job description (auto-selects profile) |
| `POST /api/ai/enhance-field` | `AiController` | AI-enhance a single text field |
| `GET /api/settings/preferences` | `SettingsController` | Read user's global AI preferences |
| `PUT /api/settings/preferences` | `SettingsController` | Update global AI preferences |
| `GET /api/usage` | `UsageController` | Current user's token usage, estimated cost, and effective spending limit (`limitUsd`) |
| `GET /api/admin/users` | `AdminUsersController` | Registered-users list for admin-api (service-to-service, API-key auth, **not** JWT) |
| `GET /api/admin/usage-limit` | `AdminUsageLimitController` | Read the global per-user spending limit (service-to-service, API-key auth) |
| `PUT /api/admin/usage-limit` | `AdminUsageLimitController` | Update the global per-user spending limit (service-to-service, API-key auth) |

**Services**
- `AuthService` — password hashing (BCrypt), JWT issuance, Google token/code verification, refresh-token rotation
- `JobProfileService`, `CvService`, `CoverLetterService`, `UsageService` — per-feature application logic (under `Features/`)
- `LlmService` — gRPC client to `llm-service`; wraps all LLM RPCs (`Generate`, `Optimize`, `ExtractProfile`, `EnhanceField`, `Chat`, `UserChat`, `GenerateCoverLetter`, `SelectBestProfile`) with Polly circuit-breaker and rate-limit handling
- **Spending limit (US-AI-7)** — `UsageService.EnsureWithinLimitAsync` runs before every LLM RPC and throws `UsageLimitExceededException` once a user's accrued estimated cost reaches the effective limit; `UsageLimitExceptionHandler` maps it to **HTTP 402** with `{ code: "usage_limit_exceeded", message, limitUsd }`. The limit is read from the `LlmUsageLimitUsd` row in `AppSettings`, falling back to `UsageLimit:MaxCostUsdPerUser` in config (default `$0.50`); admins change it via `PUT /api/admin/usage-limit`.
- `PdfService` — renders a `ProfileDocument` to PDF using QuestPDF (A4); walks `header` + the `body` block tree generically (ADR-0014)
- `RequestTracingMiddleware` — records per-request spans into the `RequestSpans` table for observability

**PDF generation**  
`PdfService.GenerateFromDocument(ProfileDocument)` renders the document generically (ADR-0014): the `header` (name, title, contacts) followed by a **recursive walk of the `body` block tree** — one handler per node type (section → heading + flow, paragraph → text, link → a hyperlink line, list → bullets with indentation for nesting, chips → tag cloud, timeline → entries with title / dates / description). User-created sections (Projects, Publications, …) and nested widgets flow to the PDF without code changes; unknown or empty nodes degrade gracefully and depth is bounded. cv-api renders the document for both saved profiles and unsaved drafts (`POST /api/cvs/draft-pdf`).

---



### `apps/llm-service` — LLM Gateway (Python / gRPC)

A thin async service exposing LLM operations over gRPC only. `app/main.py` runs a pure `grpc.aio` server (port `GRPC_PORT`, default 8080) plus a Prometheus metrics HTTP endpoint (`prometheus_client.start_http_server`, port `METRICS_PORT`, default 9090). There is no FastAPI/HTTP API anymore; `cv-api` is the sole consumer, over gRPC, in all environments. A standard gRPC health servicer (async) answers Cloud Run health checks.

**Operations** (implemented in `app/grpc/servicer.py`, prompt chains in `app/chains/`)
| Operation | Description |
|---|---|
| `Generate` | Takes a profile document + optional notes → returns a tailored `ProfileDocument` (ADR-0013) |
| `Optimize` | Takes a profile document + free-text instruction → returns a rewritten `ProfileDocument` |
| `ExtractProfile` | Takes raw CV text → returns a `ProfileDocument` (header + a `body` block tree inferred from the CV) |
| `EnhanceField` | Takes one text field + its purpose → returns an improved version |
| `Chat` | Profile-scoped conversational assistant |
| `UserChat` | Account-wide chat over profile summaries; may return a `PreferencesUpdate` that cv-api persists to `User.GlobalPreferences` |
| `GenerateCoverLetter` | Job description (+ selected/auto profile) → cover letter text |
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
All model calls in llm-service are traced to a self-hosted Langfuse when configured. Both invocation paths are instrumented through `app/observability.py`: the LangChain path (google/openai/azure) via a `CallbackHandler`, and the direct Anthropic path (anthropic/foundry) via a generation span recording model + token usage. A gRPC server interceptor (`app/grpc/trace_interceptor.py`) opens the root trace per RPC.

Tracing is **opt-in and no-op when unconfigured** — it activates only when all three vars are set:

| Env var | Notes |
|---|---|
| `LANGFUSE_PUBLIC_KEY` | `pk-...`; absence of any of the three disables tracing entirely |
| `LANGFUSE_SECRET_KEY` | `sk-...` (Secret Manager in prod, [ADR-0002](doc/adr/0002-secret-management.md)) |
| `LANGFUSE_HOST` | Langfuse base URL (self-hosted). In prod, the internal IP of the Langfuse VM ([ADR-0011](doc/adr/0011-langfuse-prod-single-vm.md)) |

cv-api propagates request correlation context to llm-service as gRPC metadata — `x-trace-id` (the cv-api `TraceContext.TraceId`) and `x-user-id` (authenticated user). llm-service maps the trace id deterministically (`Langfuse.create_trace_id(seed=...)`) and sets `user_id`, so each Langfuse trace links back to the cv-api `RequestSpan` rows for the same request. Locally, bring up Langfuse with the opt-in overlay: `docker compose -f docker-compose.yml -f docker-compose.langfuse.yml up` (UI at `http://localhost:3030`).

**LLM evals — Langfuse datasets + experiments ([ADR-0012](doc/adr/0012-langfuse-evals.md))**
Offline evals live in `apps/llm-service/evals/`. Fixtures (`evals/fixtures/*.jsonl`) are the version-controlled source of truth; each run upserts them into a Langfuse dataset named `eval-<operation>` and runs an experiment (`Langfuse.run_experiment`) over the items. Targets (`evals/targets.py`) call each LLM operation; evaluators (`evals/evaluators.py`) emit `Evaluation` scores — deterministic extraction-accuracy checks plus Claude-as-judge quality/on-task/preference-adherence scorers. Each score carries a rationale `comment` (the judge's reasoning, or the deterministic expected-vs-got detail) and `{operation, model}` metadata, so the Langfuse scores table is self-explanatory rather than bare numbers; the dataset-run view is the per-item lens. Each operation's run is tagged with the Langfuse tracing environment `eval-<operation>`, so the scores/traces **Environment** column (sortable and filterable) shows which operation a score belongs to. Aggregate scores are checked against per-operation thresholds and the process exits non-zero on a breach (CI quality gate); results are also written to `evals/results/<operation>_latest.json` and viewable in the Langfuse UI. Running evals **requires** the `LANGFUSE_*` credentials (unlike live tracing, which is opt-in/no-op). Locally, start the Langfuse overlay and run `npm run evals` (the `llm-service:evals` Nx target injects the overlay's local-dev keys; bare run = all operations, forward args via `npm run evals -- --operation extract` or `-- --sync-only`). Against a non-local Langfuse, set `LANGFUSE_*` and call the module directly: `cd apps/llm-service && python -m evals.run_evals --operation all`.

---

### `apps/admin-api` + `apps/admin-ui` — Admin Plane

A separate admin panel for operating the product, isolated from the user-facing plane.

| App | Stack | Role |
|---|---|---|
| `admin-api` | NestJS (global prefix `/api`, port 3000) | Admin backend: admin login (`POST /api/auth/google`, `POST /api/auth/login`), registered-users list (`GET /api/users`) |
| `admin-ui` | Next.js | Admin frontend; calls `admin-api` (`ADMIN_API_URL`) and embeds Grafana dashboards (`GRAFANA_URL`) |

`admin-api` owns **one** database — its own admin PostgreSQL database for admin users/sessions (initialized by `apps/admin-api/migrations/init-admin-db.sql`). It does **not** touch the main application database. For user data it calls cv-api's `GET /api/admin/users` over HTTP (`CV_API_URL`), authenticated with a shared API key (`CV_API_ADMIN_KEY`) that cv-api validates against `AdminApi:ApiKey` — cv-api is the sole owner of the `Users`/`Profiles` schema ([ADR-0005](doc/adr/0005-admin-api-via-cv-api.md), superseding [ADR-0004](doc/adr/0004-admin-api-main-db-access.md)). The same pattern carries the per-user spending limit: admin-ui → admin-api `GET/PUT /api/usage-limit` → cv-api `GET/PUT /api/admin/usage-limit`, exposed in admin-ui at `/settings` (US-AI-7). Domain docs: [`doc/admin/`](doc/admin/).

---

### `apps/chrome-extension` — Job Application Auto-Fill (Chrome MV3)

A Manifest V3 extension ("Applysy — Job Fill", TypeScript + Vite, React popup) that fills job-application forms using the user's profiles. It is a pure client of `cv-api` — no backend of its own.

- `Alt+Shift+F` — content script heuristically detects cover-letter/free-text fields on the page and fills them via `POST /api/cover-letter` (the backend auto-selects the best profile)
- `Alt+Shift+D` — generates and downloads an optimized CV PDF for the current job posting (`POST /api/cvs/generate-auto`, or `POST /api/job-profiles/:id/cvs` + PDF download when a profile is forced in the popup)
- Auth: Google sign-in via `chrome.identity` → `POST /api/auth/google/token`, or email/password login; the JWT is stored in `chrome.storage.local` under the shared `TOKEN_KEY` constant from `@applysy/auth`

Domain docs: [`doc/chrome-extension/`](doc/chrome-extension/).

---

## Data Model

```
User
 ├── id (UUID PK)
 ├── email (unique)
 ├── passwordHash (nullable)
 ├── googleId (nullable, unique)
 ├── createdAt
 └── globalPreferences  — nullable free-text AI preferences (edited on /settings or by the UserChat agent)

Profile  (FK → User, cascade delete)
 ├── id, userId
 ├── name          — internal label (e.g. "Senior Dev Profile")
 ├── document      — JSON column: the canonical ProfileDocument { header, sections[] } (ADR-0013).
 │                   Replaces the former fullName/title/overview/location/contactEmail/contactPhone/
 │                   sectionOrder columns and the WorkExperiences/Educations/Skills child tables,
 │                   which were backfilled into the document and dropped.
 └── GeneratedCvs[]     (cascade delete)

GeneratedCv  (FK → Profile, cascade delete)
 ├── id, profileId
 ├── createdAt
 ├── fullName, title, location, contactEmail, contactPhone  — snapshot at generation time
 ├── optimizationNotes  — free-text hint passed to LLM
 └── cvDataJson  — serialized LlmGenerateResponse (summary, work, education, skills, highlights)

LlmUsage  (no FK constraint; UserId nullable for system calls)
 ├── id (UUID PK)
 ├── userId (Guid, nullable, indexed)
 ├── operation  — "Generate" | "Optimize" | "Extract" | "EnhanceField" | "Chat" | "UserChat" | "CoverLetter" | "GenerateAuto"
 ├── promptTokens, completionTokens (int)
 ├── modelName  — e.g. "claude-sonnet-4-6"
 └── createdAt (UTC, indexed)

RefreshToken  (FK → User, cascade delete)
 ├── id (UUID PK)
 ├── userId
 ├── token  — SHA-256 hash of the cookie value (unique, max 128 chars)
 ├── expiresAt, createdAt
 └── isRevoked

AppSetting  (generic runtime key-value config, no FK)
 ├── key (string PK, max 100)  — e.g. "LlmUsageLimitUsd" (per-user spending cap, US-AI-7)
 ├── value (string, max 512)
 └── updatedAt (UTC)

RequestSpan  (no FK; observability data written by RequestTracingMiddleware)
 ├── id (bigint PK)
 ├── traceId (Guid, indexed)
 ├── service, spanKind, operation
 ├── statusCode (nullable), isError, durationMs
 └── startedAt (indexed)
```

Migrations are EF Core code-first, stored in `apps/cv-api/Infrastructure/Persistence/Migrations/`. Only cv-api reads or writes this schema; admin-api reaches `Users`/`Profiles` through cv-api's `GET /api/admin/users` ([ADR-0005](doc/adr/0005-admin-api-via-cv-api.md)). The admin plane's own database is separate and schema-managed by `apps/admin-api/migrations/init-admin-db.sql` (see the admin section above).

---

## gRPC Contract

Defined in `proto/llm_service.proto`. The C# stubs are generated at build time; the Python stubs are checked in under `apps/llm-service/app/grpc/`.

Nine RPC methods: `Generate`, `Optimize`, `ExtractProfile`, `EnhanceField`, `Chat`, `UserChat`, `Health`, `GenerateCoverLetter`, `SelectBestProfile`.

The profile is carried as `ProfileDocumentProto` (`id` + `ProfileHeaderProto header` + repeated `DocumentSectionProto sections`, each with `SectionItemProto` entries) — the wire mirror of the canonical `ProfileDocument` (ADR-0013). `Generate`, `Optimize`, `ExtractProfile`, `Chat`, and `SelectBestProfile` take and/or return documents (`Generate`/`Optimize`/`ExtractProfile` responses are a `ProfileDocumentProto document`; `Chat` returns a reply + optional patch proposal). The proto's `ProfileDocumentProto` comment points to the TypeScript and C# definitions it must stay in sync with.

---

## Infrastructure (GCP)

Managed by Terraform in `infra/`. Services run on **Cloud Run v2**; images live in **Artifact Registry**; the database is **Cloud SQL for PostgreSQL 16**. A global HTTPS load balancer (serverless NEGs) does host-based routing on one IP: `applysy.works` / `www.applysy.works` → landing, `app.applysy.works` → ui-angular, `admin.applysy.works` → admin-ui ([ADR-0007](doc/adr/0007-landing-page-deployment.md)).

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

**LLM observability — Langfuse VM ([ADR-0011](doc/adr/0011-langfuse-prod-single-vm.md)):** the self-hosted Langfuse stack (web + worker + ClickHouse + Redis + MinIO) is defined to run as a docker-compose deployment on a **single `e2-small` GCE VM** (`infra/langfuse.tf`), the cheapest hosting option. The whole stack is **gated behind `var.langfuse_enabled` (default `false`)** — committed and validated but not yet deployed; flip the flag to provision it. Its metadata DB reuses the Cloud SQL instance (a `langfuse` database); ClickHouse/MinIO state lives on a separate persistent disk that survives VM re-creation. The VM has **no inbound internet access** (firewall allows the Langfuse port only from the Cloud Run egress subnet, plus IAP for SSH); its ephemeral external IP is outbound-only, for image pulls. `llm-service` reaches it at a static internal IP via Direct VPC egress (`PRIVATE_RANGES_ONLY`, which keeps its direct path to external LLM providers). The UI is reached by an IAP SSH tunnel (`terraform output langfuse_ssh`).

**Network privacy ([ADR-0001](doc/adr/0001-llm-service-network-privacy.md)):** llm-service and Cloud SQL are not reachable from the public internet. Cloud Run v2 treats CR-to-CR `.run.app` calls as external, so callers of internal-only services route egress through the project VPC (Direct VPC egress + Private Google Access). cv-api authenticates to llm-service with a Google-signed ID token (`LlmService__AuthMode=google`); IAM (`run.invoker`) enforces it at the edge. Cloud SQL has a private IP in the VPC; its public IP has no authorized networks and serves only Cloud SQL Auth Proxy admin access.

**Secret management ([ADR-0002](doc/adr/0002-secret-management.md)):** sensitive runtime values (DB connection string, JWT secrets, OAuth client secret, LLM API keys, Grafana password) live in **Secret Manager** (`infra/secrets.tf`) and reach Cloud Run via `secret_key_ref` env references — never plaintext env vars. Each secret grants `secretAccessor` only to the consuming service's runtime SA. Terraform state is remote in a versioned GCS bucket (`applysy-tf-state`).

---

## Local Development

`docker-compose.yml` mirrors the production topology, including the admin plane and monitoring stack:

| Service | Host port | Notes |
|---|---|---|
| `postgres` | 5433 | Main DB (container 5432); cv-api and grafana connect to it (admin-api does **not** — it calls cv-api) |
| `cv-api` | 5050 | REST API (container 8080) |
| `ui-angular` | 4200 | Browser entry point; Nginx proxies `/api/*` → cv-api and `/chat-widget/*` → chat-ui |
| `chat-ui` | 4202 | Nginx serving the chat-widget bundle |
| `llm-service` | 50051 (gRPC), 8080 (metrics) | gRPC server + Prometheus metrics HTTP endpoint |
| `admin-db` | 5434 | Admin PostgreSQL (container 5432), seeded by `init-admin-db.sql` |
| `admin-api` | 3001 | NestJS admin backend (container 3000); connects to its own admin DB and calls cv-api for user data |
| `admin-ui` | 3002 | Next.js admin frontend (container 3000) |
| `prometheus` | 9090 | Scrapes `/metrics` on cv-api and llm-service |
| `grafana` | 3000 | Dashboards provisioned from `monitoring/grafana/provisioning/` |

Set `LLM_PROVIDER=openai` and `OPENAI_BASE_URL=http://host.docker.internal:1234/v1` to target a local LM Studio instance instead of a cloud API.

---

## CI/CD

`.github/workflows/deploy.yml` builds and pushes images to Artifact Registry (auth via Workload Identity Federation) and deploys to Cloud Run on push to `main`. Images are deployed by **immutable git-SHA tag**, not `:latest` — every Cloud Run service carries `lifecycle { ignore_changes = [image] }` so Terraform owns config while CI owns the running image ([ADR-0003](doc/adr/0003-migrations-and-image-pinning.md)). EF Core migrations run as the `cv-api-migrate` Cloud Run job (`cv-api migrate` CLI mode) **before** the cv-api service rolls out, not on app startup. See `DEPLOY.md` for the full from-scratch deployment guide.

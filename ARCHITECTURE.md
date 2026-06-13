# Architecture

## Overview

AI CV Maker is a web application that lets users manage job profiles and generate AI-tailored CVs and cover letters as PDF files. The system is organized as an Nx monorepo with eight apps: the user-facing plane (`ui-angular`, `chat-ui`, `cv-api`, `llm-service`), an admin plane (`admin-api`, `admin-ui`), a Chrome extension (`chrome-extension`), and a monitoring stack (Prometheus + Grafana).

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

### `libs/auth` — `@ai-cv-maker/auth`

Framework-agnostic TypeScript library used by `ui-angular` and `chat-ui`.

| Module | Purpose |
|---|---|
| `models` | `AuthRequest`, `AuthResponse`, `AuthSession`, `JwtPayload` interfaces |
| `constants` | `TOKEN_KEY` / `EMAIL_KEY` — single source of truth for localStorage keys |
| `storage` | `getToken()`, `getSession()`, `saveSession()`, `clearSession()` |
| `token` | `parseJwt()`, `isTokenExpired()`, `getTokenExpiry()` — client-side JWT decode |
| `api` | `loginApi()`, `registerApi()`, `googleLoginApi()` — plain `fetch` wrappers |
| `broadcast` | `createAuthBroadcast()` — cross-tab logout sync via `BroadcastChannel` |

Import path: `@ai-cv-maker/auth` (path alias registered in `tsconfig.base.json`, picked up automatically by `nxViteTsPaths()` in Vite apps and the Angular compiler via tsconfig extends).

See [`libs/auth/README.md`](libs/auth/README.md) for usage examples and design rationale.

---

## Authentication Flow

```
User submits credentials
        │
        ▼
  loginApi() / registerApi() / googleLoginApi()   ← @ai-cv-maker/auth
        │  POST /api/auth/{login|register|google}
        ▼
    cv-api validates → issues HS256 JWT (1-hour expiry)
                     → sets HttpOnly refresh token cookie (30-day, SHA-256 hashed in DB)
        │
        ▼
  saveSession(token, email)   ← @ai-cv-maker/auth
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

### `apps/ui-angular` — Angular SPA

Angular 21 standalone-component application served by Nginx. The Nginx container uses `envsubst` to inject `CV_API_UPSTREAM` at runtime, forwarding `/api/*` to the backend — no CORS is needed in production.

**Routes**
| Path | Component | Guard |
|---|---|---|
| `/auth/login` | `LoginComponent` | — |
| `/auth/register` | `RegisterComponent` | — |
| `/job-profiles` | `JobProfilesComponent` | `authGuard` |
| `/job-profiles/:id` | `ProfileComponent` | `authGuard` |
| `/job-profiles/:id/pdf` | `PdfPreviewPageComponent` | `authGuard` |
| `/chat` | `ChatPageComponent` (hosts `<ai-chat-widget>`) | `authGuard` |
| `/settings` | `SettingsComponent` (global AI preferences) | `authGuard` |
| `/usage` | `UsageComponent` (token usage & cost) | `authGuard` |

**Key features**
- Reactive forms with drag-and-drop section ordering (`@angular/cdk/drag-drop`)
- Inline PDF preview (`PdfPreviewComponent` wraps a blob URL in an `<iframe>`)
- Live profile preview (`ProfilePreviewComponent`)
- Theme service (dark/light)

---

### `apps/chat-ui` — AI Chat Widget (React Web Component)

A self-contained React chat interface packaged as a [Custom Element](https://developer.mozilla.org/en-US/docs/Web/API/Web_components/Using_custom_elements) (`<ai-chat-widget>`). It is **not a standalone SPA** — it is built as a single IIFE JavaScript file and embedded inside `ui-angular`.

**Build output**

Vite builds the entire app — React, CSS, and all — into one file:

```
dist/apps/chat-ui/chat-widget.js   ← self-contained IIFE (~50 kB gzipped)
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

`ChatApp` reads `authToken` from the attribute and adds it as an `Authorization: Bearer` header on every `POST /api/chat` request. The token is sourced from `AuthService.getToken()` in Angular — which in turn reads from `@ai-cv-maker/auth`'s `getToken()`.

**API**

| Method | Endpoint | Body | Purpose |
|---|---|---|---|
| `POST` | `/api/chat` | `{ message, history[] }` | Send a message; receive `{ reply }` |

`history` is the in-memory conversation array (filtered to `user`/`assistant` roles), sent with every request so `cv-api` can forward full context to the LLM.

**Components**

| Component | File | Role |
|---|---|---|
| `ChatApp` | `src/ChatApp.tsx` | Root — owns message state, calls the API, renders the layout |
| `MessageList` | `src/components/MessageList.tsx` | Renders the conversation; shows an empty-state prompt when no messages exist |
| `MessageInput` | `src/components/MessageInput.tsx` | Textarea + Send button; `Enter` submits, `Shift+Enter` inserts a newline |

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
| `GET /api/job-profiles/:id` | `JobProfileController` | Get full profile |
| `PUT /api/job-profiles/:id` | `JobProfileController` | Replace profile content |
| `DELETE /api/job-profiles/:id` | `JobProfileController` | Delete profile |
| `POST /api/job-profiles/:id/optimize` | `JobProfileController` | AI-rewrite profile via LLM |
| `POST /api/job-profiles/:id/chat` | `JobProfileController` | Profile-scoped AI chat |
| `POST /api/job-profiles/:id/extract` | `JobProfileController` | Import profile from CV file (PDF/text, ≤10 MB) |
| `GET /api/job-profiles/:id/cvs` | `CvController` | List generated CVs |
| `POST /api/job-profiles/:id/cvs` | `CvController` | Generate new tailored CV via LLM |
| `GET /api/job-profiles/:id/cvs/:cvId/pdf` | `CvController` | Download generated CV as PDF |
| `GET /api/job-profiles/:id/cvs/default/pdf` | `CvController` | Download raw (non-LLM) profile as PDF |
| `DELETE /api/job-profiles/:id/cvs/:cvId` | `CvController` | Delete generated CV |
| `POST /api/cvs/generate-auto` | `CvController` | LLM selects best profile then generates CV |
| `POST /api/cvs/draft-pdf` | `CvController` | Render an unsaved profile draft as PDF (live preview) |
| `POST /api/chat` | `ChatController` | Account-wide AI chat (used by `<ai-chat-widget>`); can update `GlobalPreferences` when the agent signals one |
| `POST /api/cover-letter` | `CoverLetterController` | Generate cover letter from job description (auto-selects profile) |
| `POST /api/ai/enhance-field` | `AiController` | AI-enhance a single text field |
| `GET /api/settings/preferences` | `SettingsController` | Read user's global AI preferences |
| `PUT /api/settings/preferences` | `SettingsController` | Update global AI preferences |
| `GET /api/usage` | `UsageController` | Current user's token usage & estimated cost |
| `GET /api/admin/users` | `AdminUsersController` | Registered-users list for admin-api (service-to-service, API-key auth, **not** JWT) |

**Services**
- `AuthService` — password hashing (BCrypt), JWT issuance, Google token/code verification, refresh-token rotation
- `JobProfileService`, `CvService`, `CoverLetterService`, `UsageService` — per-feature application logic (under `Features/`)
- `LlmService` — gRPC client to `llm-service`; wraps all LLM RPCs (`Generate`, `Optimize`, `ExtractProfile`, `EnhanceField`, `Chat`, `UserChat`, `GenerateCoverLetter`, `SelectBestProfile`) with Polly circuit-breaker and rate-limit handling
- `PdfService` — renders CV to PDF using QuestPDF (A4, respects user-defined `SectionOrder`)
- `RequestTracingMiddleware` — records per-request spans into the `RequestSpans` table for observability

**PDF generation**  
`PdfService.GenerateCv` renders header, summary, highlights, then iterates `sectionOrder` (comma-separated string stored on `Profile`) to emit work experience, education, and skills sections in user-defined order.

---



### `apps/llm-service` — LLM Gateway (Python / gRPC)

A thin async service exposing LLM operations over gRPC only. `app/main.py` runs a pure `grpc.aio` server (port `GRPC_PORT`, default 8080) plus a Prometheus metrics HTTP endpoint (`prometheus_client.start_http_server`, port `METRICS_PORT`, default 9090). There is no FastAPI/HTTP API anymore; `cv-api` is the sole consumer, over gRPC, in all environments. A standard gRPC health servicer (async) answers Cloud Run health checks.

**Operations** (implemented in `app/grpc/servicer.py`, prompt chains in `app/chains/`)
| Operation | Description |
|---|---|
| `Generate` | Takes a full profile + optional notes → returns tailored CV content (summary, work, education, skills, highlights) |
| `Optimize` | Takes a profile + free-text instruction → returns rewritten title, overview, work experiences, and skills |
| `ExtractProfile` | Takes raw CV text → returns structured profile fields |
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

---

### `apps/admin-api` + `apps/admin-ui` — Admin Plane

A separate admin panel for operating the product, isolated from the user-facing plane.

| App | Stack | Role |
|---|---|---|
| `admin-api` | NestJS (global prefix `/api`, port 3000) | Admin backend: admin login (`POST /api/auth/google`, `POST /api/auth/login`), registered-users list (`GET /api/users`) |
| `admin-ui` | Next.js | Admin frontend; calls `admin-api` (`ADMIN_API_URL`) and embeds Grafana dashboards (`GRAFANA_URL`) |

`admin-api` owns **one** database — its own admin PostgreSQL database for admin users/sessions (initialized by `apps/admin-api/migrations/init-admin-db.sql`). It does **not** touch the main application database. For user data it calls cv-api's `GET /api/admin/users` over HTTP (`CV_API_URL`), authenticated with a shared API key (`CV_API_ADMIN_KEY`) that cv-api validates against `AdminApi:ApiKey` — cv-api is the sole owner of the `Users`/`Profiles` schema ([ADR-0005](doc/adr/0005-admin-api-via-cv-api.md), superseding [ADR-0004](doc/adr/0004-admin-api-main-db-access.md)). Domain docs: [`doc/admin/`](doc/admin/).

---

### `apps/chrome-extension` — Job Application Auto-Fill (Chrome MV3)

A Manifest V3 extension ("AI CV Maker — Job Fill", TypeScript + Vite, React popup) that fills job-application forms using the user's profiles. It is a pure client of `cv-api` — no backend of its own.

- `Alt+Shift+F` — content script heuristically detects cover-letter/free-text fields on the page and fills them via `POST /api/cover-letter` (the backend auto-selects the best profile)
- `Alt+Shift+D` — generates and downloads an optimized CV PDF for the current job posting (`POST /api/cvs/generate-auto`, or `POST /api/job-profiles/:id/cvs` + PDF download when a profile is forced in the popup)
- Auth: Google sign-in via `chrome.identity` → `POST /api/auth/google/token`, or email/password login; the JWT is stored in `chrome.storage.local` under the shared `TOKEN_KEY` constant from `@ai-cv-maker/auth`

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
 ├── fullName, title, overview, location
 ├── contactEmail, contactPhone
 ├── sectionOrder  — comma-separated: "workExperiences,educations,skills"
 ├── WorkExperiences[]  (cascade delete)
 ├── Educations[]       (cascade delete)
 ├── Skills[]           (ordered by `Order`, cascade delete)
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

---

## Infrastructure (GCP)

Managed by Terraform in `infra/`. Services run on **Cloud Run v2**; images live in **Artifact Registry**; the database is **Cloud SQL for PostgreSQL 16**. A global HTTPS load balancer (serverless NEGs) serves `app.applysy.works` → ui-angular and `admin.applysy.works` → admin-ui.

| Cloud Run service | Instances | Ingress | Invoker | VPC egress |
|---|---|---|---|---|
| `llm-service` | 0–2 | Internal only | cv-api SA only | none (direct internet to LLM providers) |
| `cv-api` | 1–2 | All | `allUsers` (public API) | ALL_TRAFFIC |
| `chat-ui` | 0–2 | Internal only | `allUsers` | none |
| `ui-angular` | 0–2 | All | `allUsers` | ALL_TRAFFIC |
| `prometheus` | 1 | Internal only | — | none |
| `grafana` | — | All | `allUsers` | ALL_TRAFFIC |
| `admin-api` | 0–2 | Internal only | — | ALL_TRAFFIC |
| `admin-ui` | 0–2 | All | `allUsers` | ALL_TRAFFIC |

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

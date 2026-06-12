# Architecture

## Overview

AI CV Maker is a three-tier web application that lets users manage job profiles and generate AI-tailored CVs as PDF files. The system is organized as an Nx monorepo with three deployable services.

```
Browser
  └─ ui-angular (Angular SPA)
       └─ <ai-chat-widget>  ← loaded from chat-ui via Nginx proxy
            │
            └─ REST/HTTP ──→ cv-api (ASP.NET Core)
                                 ├─ PostgreSQL (EF Core)
                                 └─ gRPC ──→ llm-service (Python / FastAPI)
                                                  └─ LLM provider (Google, OpenAI-compat, Azure Foundry)

Nginx (ui-angular container)
  ├─ /api/*          → cv-api
  └─ /chat-widget/*  → chat-ui (Nginx serving chat-widget.js IIFE)
```

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
| Route prefix | Controller | Purpose |
|---|---|---|
| `POST /api/auth/register` | `AuthController` | Email/password registration |
| `POST /api/auth/login` | `AuthController` | Email/password login → JWT + HttpOnly refresh cookie |
| `POST /api/auth/google` | `AuthController` | Google One-Tap login → JWT + HttpOnly refresh cookie |
| `POST /api/auth/refresh` | `AuthController` | Rotate refresh token → new JWT |
| `POST /api/auth/logout` | `AuthController` | Revoke refresh token in DB + clear cookie |
| `GET /api/job-profiles` | `JobProfileController` | List profiles for current user |
| `POST /api/job-profiles` | `JobProfileController` | Create profile |
| `GET /api/job-profiles/:id` | `JobProfileController` | Get full profile |
| `PUT /api/job-profiles/:id` | `JobProfileController` | Replace profile content |
| `DELETE /api/job-profiles/:id` | `JobProfileController` | Delete profile |
| `POST /api/job-profiles/:id/optimize` | `JobProfileController` | AI-rewrite profile via LLM |
| `POST /api/job-profiles/:id/extract` | `JobProfileController` | Import profile from CV file (PDF/text) |
| `GET /api/job-profiles/:id/cvs` | `CvController` | List generated CVs |
| `POST /api/job-profiles/:id/cvs` | `CvController` | Generate new tailored CV via LLM |
| `GET /api/job-profiles/:id/cvs/:cvId/pdf` | `CvController` | Download generated CV as PDF |
| `GET /api/job-profiles/:id/cvs/default/pdf` | `CvController` | Download raw (non-LLM) profile as PDF |
| `DELETE /api/job-profiles/:id/cvs/:cvId` | `CvController` | Delete generated CV |
| `POST /api/cvs/generate-auto` | `CvController` | LLM selects best profile then generates CV |
| `GET /api/usage` | `UsageController` | Current user's token usage & estimated cost |

**Services**
- `AuthService` — password hashing (BCrypt), JWT issuance, Google token verification
- `LlmService` — gRPC client to `llm-service`; calls `Generate`, `Optimize`, `ExtractProfile`, `SelectBestProfile`
- `PdfService` — renders CV to PDF using QuestPDF (A4, respects user-defined `SectionOrder`)

**PDF generation**  
`PdfService.GenerateCv` renders header, summary, highlights, then iterates `sectionOrder` (comma-separated string stored on `Profile`) to emit work experience, education, and skills sections in user-defined order.

---

### `apps/llm-service` — LLM Gateway (Python / FastAPI + gRPC)

A thin async service that exposes three LLM operations over both HTTP (FastAPI) and gRPC (same logic, different transport). The gRPC interface is the one used by `cv-api` in all environments.

**Operations**
| Operation | Description |
|---|---|
| `Generate` | Takes a full profile + optional notes → returns tailored CV content (summary, work, education, skills, highlights) |
| `Optimize` | Takes a profile + free-text instruction → returns rewritten title, overview, work experiences, and skills |
| `ExtractProfile` | Takes raw CV text → returns structured profile fields |

**LLM provider switching**  
Controlled entirely by environment variables — no code changes required:

| `LLM_PROVIDER` | Model variable | Notes |
|---|---|---|
| `google` (default) | `LLM_MODEL` or `gemini-1.5-flash` | Requires `GOOGLE_API_KEY` |
| `openai` | `OPENAI_MODEL` | Any OpenAI-compatible endpoint; default points to LM Studio on localhost |
| `foundry` | `FOUNDRY_DEPLOYMENT_NAME` / `LLM_MODEL` | Azure AI Foundry (e.g., Claude via Anthropic); requires `FOUNDRY_API_KEY` |

---

## Data Model

```
User
 ├── id (UUID PK)
 ├── email (unique)
 ├── passwordHash (nullable)
 └── googleId (nullable, unique)

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
```

Migrations are EF Core code-first, stored in `apps/cv-api/Migrations/`.

---

## gRPC Contract

Defined in `proto/llm_service.proto`. The C# stubs are generated at build time; the Python stubs are checked in under `apps/llm-service/app/grpc/`.

Four RPC methods: `Generate`, `Optimize`, `ExtractProfile`, `Health`.

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

---

## Local Development

`docker-compose.yml` mirrors the production topology:

```
postgres:5432   ←  cv-api connects via EF Core
cv-api:8080     ←  ui-angular proxies /api/* here
ui-angular:80   →  browser at localhost:4200
llm-service:50051 (gRPC) + :8000 (HTTP health)
```

Set `LLM_PROVIDER=openai` and `OPENAI_BASE_URL=http://host.docker.internal:1234/v1` to target a local LM Studio instance instead of a cloud API.

---

## CI/CD

`.github/workflows/deploy.yml` builds and pushes images to Artifact Registry (auth via Workload Identity Federation) and deploys to Cloud Run on push to `main`. See `DEPLOY.md` for the full from-scratch deployment guide.

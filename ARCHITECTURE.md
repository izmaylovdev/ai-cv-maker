# Architecture

## Overview

AI CV Maker is a three-tier web application that lets users manage job profiles and generate AI-tailored CVs as PDF files. The system is organized as an Nx monorepo with three deployable services.

```
Browser
  └─ ui-angular (Angular SPA, served via Nginx)
       └─ REST/HTTP ──→ cv-api (ASP.NET Core)
                             ├─ PostgreSQL (EF Core)
                             └─ gRPC ──→ llm-service (Python / FastAPI)
                                              └─ LLM provider (Google, OpenAI-compat, Azure Foundry)
```

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

### `apps/cv-api` — REST API (ASP.NET Core 8)

The central backend. Exposes a JSON REST API, owns the database, generates PDFs, and orchestrates all LLM calls via gRPC.

**Controllers**
| Route prefix | Controller | Purpose |
|---|---|---|
| `POST /api/auth/register` | `AuthController` | Email/password registration |
| `POST /api/auth/login` | `AuthController` | Email/password login → JWT |
| `POST /api/auth/google` | `AuthController` | Google One-Tap login → JWT |
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

**Services**
- `AuthService` — password hashing (BCrypt), JWT issuance, Google token verification
- `LlmService` — gRPC client to `llm-service`; calls `Generate`, `Optimize`, `ExtractProfile`
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
```

Migrations are EF Core code-first, stored in `apps/cv-api/Migrations/`.

---

## gRPC Contract

Defined in `proto/llm_service.proto`. The C# stubs are generated at build time; the Python stubs are checked in under `apps/llm-service/app/grpc/`.

Four RPC methods: `Generate`, `Optimize`, `ExtractProfile`, `Health`.

---

## Infrastructure (Azure)

Managed by Terraform in `infra/`. All three services run as **Azure Container Apps** in a shared environment backed by a **Log Analytics Workspace**.

| Container App | Replicas | Ingress | Notes |
|---|---|---|---|
| `llm-service` | 0–2 | Internal, HTTP/2 (gRPC), port 50051 | Scale-to-zero enabled |
| `cv-api` | 1–2 | External HTTPS, port 8080 | Always-on |
| `ui-angular` | 0–2 | External HTTPS, port 80 | Scale-to-zero; injects `CV_API_UPSTREAM` via `envsubst` |

Database: **Azure Database for PostgreSQL Flexible Server** (SSL required).  
Images: stored in an **Azure Container Registry**.

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

`azure-pipelines.yml` defines the build and release pipeline targeting Azure Container Apps.

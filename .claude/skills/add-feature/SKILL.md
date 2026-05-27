---
name: add-feature
description: Add a new feature or change to this project. Use when asked to implement a feature, add functionality, build something new, or make a product change. Drives the full workflow: user story → spec → tests → implementation.
---

Nx monorepo: Angular SPA (`apps/ui-angular`), ASP.NET Core API (`apps/cv-api`), Python FastAPI LLM service (`apps/llm-service`). All paths below are relative to the repo root.

Follow the four phases in order. **Pause for approval after Phase 1 and Phase 2 before continuing.** Never skip ahead.

---

## Phase 1: User Story

**File:** `doc/user-stories/<area>.md`

Area must be one of: `authentication`, `job-profiles`, `profile-editing`, `ai-enhancement`, `cv-generation`. For a genuinely new domain, create a new file.

Read the target file first to find the highest existing story ID, then append:

```markdown
### US-<AREA>-<N> — <Short title>

**As a** <user type>,
**I want to** <goal>,
**so that** <benefit>.

**Acceptance criteria:**
- <criterion>
- <criterion>
```

ID examples: `US-CV-7`, `US-AUTH-6`. Increment from the last ID in the file.

**Stop here.** Present the user story draft and wait for the user to approve it before moving to Phase 2.

---

## Phase 2: Spec

**File:** `doc/specs/<area>.md`

Read the file. Append a new section (increment the section number):

```markdown
## <N>. <Feature Name> (US-<ID>)

### <N>.1 Functional Requirements

| # | Requirement |
|---|-------------|
| F-<AREA>-<N.1> | <requirement — maps to one acceptance criterion> |
| F-<AREA>-<N.2> | … |

### <N>.2 Technical Specification

#### API (if endpoint is new or changed)

`<METHOD> /api/<route>`

Request body:
```json
{ … }
```

Response 200:
```json
{ … }
```

Error responses: <status>: <description>.

#### Data model (if schema changes)

List new fields/tables and their types.

#### gRPC (only if llm-service is involved)

List proto changes needed in `proto/llm_service.proto`. Regenerate with:
```bash
npm run grpc:generate
```

#### Angular (if frontend is involved)

New or changed components, services, or routes.

#### Out of scope (MVP)

- <explicitly deferred items>
```

Requirement ID format: `F-<AREA>-<SECTION.N>` — e.g. `F-CV-7.1`.

**Stop here.** Present the spec and wait for the user to approve it before moving to Phase 3.

---

## Phase 3: Tests

Write tests **before** implementation. Tests should fail at this point (red).

### E2E (Playwright) — required for any UI change

**File:** `apps/ui-angular/e2e/<area>.spec.ts` — add to the existing file for the area.

```typescript
import { test, expect } from '@playwright/test';
import { setupAuth } from './support/auth';
import { API_URL } from './support/constants';

test.describe('<Feature name>', () => {
  test.beforeEach(async ({ page }) => {
    await setupAuth(page);
    // Mock API responses if the backend is not yet implemented:
    // await page.route('**/api/<route>', route => route.fulfill({ json: { … } }));
    await page.goto('/<route>');
  });

  test('<acceptance criterion text>', async ({ page }) => {
    // …
  });
});
```

Confirm they fail red before moving on:

```bash
npx nx run ui-angular:e2e -- --headed=false 2>&1 | tail -30
```

### API integration test — for new/changed endpoints in cv-api

If no test project exists yet, skip and note it. Otherwise add to the appropriate test file in `apps/cv-api/`.

### LLM service test — for new operations

**File:** `apps/llm-service/app/` — add a pytest test file if modifying chains or gRPC handlers.

```python
import pytest
from app.chains.<module> import <function>

def test_<feature>():
    result = <function>(…)
    assert …
```

Run:
```bash
cd apps/llm-service && .venv/bin/pytest -x 2>&1 | tail -20
```

---

## Phase 4: Implementation

Implement in the affected services. After each service, run its relevant tests.

### Angular (`apps/ui-angular/src/app/`)

| What | Where |
|---|---|
| Feature components | `features/<area>/` |
| Shared services | `core/services/` |
| New route | `app.routes.ts` |
| HTTP calls | service method → `HttpClient` with `/api/` prefix |

Standalone components only — no NgModules. Reactive forms for all data entry.

Run the dev server to verify UI changes:
```bash
npm run serve:app   # Angular on http://localhost:4200
```

### ASP.NET Core API (`apps/cv-api/`)

| What | Where |
|---|---|
| Domain entities | `Domain/` |
| Feature handlers/endpoints | `Features/<Area>/` |
| DB schema change | `dotnet ef migrations add <MigrationName> -p apps/cv-api` |
| LLM call | via `LlmService` gRPC client in `Infrastructure/` |

All non-auth routes require `[Authorize]`. LLM calls always go through cv-api → gRPC → llm-service — never directly from the frontend.

Run the API:
```bash
npm run serve:cv-api   # .NET API on http://localhost:5050
```

### LLM service (`apps/llm-service/app/`)

| What | Where |
|---|---|
| New chain/prompt | `chains/<feature>_chain.py` |
| gRPC handler | `grpc/` — register in `servicer.py` |
| Proto change | `proto/llm_service.proto` → `npm run grpc:generate` |

Run the service:
```bash
npm run serve:llm   # FastAPI on http://localhost:8080
```

### Confirm tests pass (green)

After all implementation is done, re-run the Phase 3 tests and confirm they all pass:

```bash
npx nx run ui-angular:e2e -- --headed=false 2>&1 | tail -30
```

---

## Conventions

- Requirement IDs: `F-<AREA>-<SECTION.N>` (e.g. `F-CV-7.1`)
- Story IDs: `US-<AREA>-<N>` (e.g. `US-CV-7`)
- API routes: `/api/job-profiles/:id/<action>` — follow existing REST patterns
- JWT required on all non-auth API routes
- gRPC is the transport between cv-api and llm-service in all environments
- Angular: standalone components, reactive forms, no NgModules

## Area → ID prefix map

| Area | Prefix |
|---|---|
| `authentication` | `AUTH` |
| `job-profiles` | `PROF` |
| `profile-editing` | `EDIT` |
| `ai-enhancement` | `AI` |
| `cv-generation` | `CV` |

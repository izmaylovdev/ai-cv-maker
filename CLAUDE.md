# Claude Instructions — Applysy

## Workflow: Design First, Always

For every functional change — new feature, modification, or refactor — use the `add-feature` skill. Do not write code first and describe it later.

The order is:
1. Change brief — the goal, plus acceptance criteria written as observable user outcomes
2. Design note — behaviour, API, data model, edge cases
3. Tests
4. Implementation
5. Verification — prove each acceptance criterion works in a real browser against the local stack (the skill's `browser-verifier` subagent does this)
6. Documentation update — rewrite the affected feature doc in `doc/<domain>/`
7. Commit on the feature branch and open a PR automatically (merging stays with the user)

Never skip the design phase, even for small changes.

The brief and design note are working documents for one change: they live in the scratchpad and end up in the PR body, not in the repo. The repo's permanent record is the **feature doc**, which describes how the system behaves **today** — present tense, no US-IDs, no per-increment sections. When behaviour changes, rewrite the affected part of the doc; git history holds the previous version and the ADRs hold the reasoning.

The skill does all work in a dedicated git worktree on a feature branch by default — `main` in the primary checkout stays clean until the branch is reviewed and merged.

**Exception — infrastructure / security / cross-service work:** record the
decision as an ADR in `doc/adr/` (template in `doc/adr/README.md`). Optionally
pair it with outcome-level acceptance criteria for verification; those must stay
at the observable-outcome level (no resource names, no tech choices — those
belong in the ADR).

## Documentation Must Stay in Sync

After every implementation, verify that relevant docs are updated:
- `ARCHITECTURE.md` — if the system topology, data model, API routes, or service responsibilities changed
- `doc/<domain>/` — the feature doc(s) covering what changed; rewrite the affected sections rather than appending a new one
- `doc/adr/` — a new ADR when the change rests on a decision worth recording
- `README.md` — if setup, commands, or high-level description changed
- In-code comments — only where the *why* is non-obvious

If docs are out of date, update them as part of the same change, not a follow-up.

## UI Changes: Angular Only

`apps/ui-angular` is the sole production SPA. All UI changes go here. `apps/ui-react` has been removed from the project.

## Project Structure

Nx monorepo. Key apps:

| App | Stack | Role |
|---|---|---|
| `apps/ui-angular` | Angular 21 | Primary SPA (main UI) |
| `apps/chat-ui` | React Web Component | AI chat widget embedded in Angular |
| `apps/profile-builder-ui` | React Web Component | Canonical document-style profile editor (`<applysy-profile-builder>`), embedded in Angular at `/job-profiles/:id` (ADR-0013) |
| `apps/cv-api` | ASP.NET Core 9 | REST API, PDF generation, gRPC client |
| `apps/llm-service` | Python / gRPC (grpc.aio) | LLM gateway |
| `apps/admin-api` | NestJS | Admin backend |
| `apps/admin-ui` | Next.js | Admin frontend |

Shared library: `libs/auth` (`@applysy/auth`) — auth utilities shared by Angular and React.

See `ARCHITECTURE.md` for full system design, data model, and API reference.

## Common Commands

```sh
# Serve Angular UI
npx nx run ui-angular:serve

# Serve chat widget (dev, port 4202)
npm run serve:chat

# Run all tests
npx nx run-many --target=test

# Run specific app tests
npx nx run ui-angular:test
npx nx run cv-api:test

# Lint
npx nx run-many --target=lint

# Docker local stack
docker-compose up
```

## Key Conventions

- Angular app uses standalone components (no NgModules)
- Auth token stored in `localStorage` via `@applysy/auth` constants — do not hardcode key names
- LLM provider is controlled by env vars (`LLM_PROVIDER`, `LLM_MODEL`, etc.) — no code changes needed to switch
- EF Core migrations live in `apps/cv-api/Infrastructure/Persistence/Migrations/` — always generate a migration for schema changes
- gRPC contract is the source of truth in `proto/llm_service.proto`

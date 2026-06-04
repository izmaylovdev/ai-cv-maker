# Claude Instructions — AI CV Maker

## Workflow: Spec First, Always

For every functional change — new feature, modification, or refactor — use the `add-feature` skill. Do not write code first and spec later.

The order is:
1. User story / goal
2. Spec (what it does, edge cases, acceptance criteria)
3. Tests
4. Implementation
5. Documentation update

Never skip the spec phase, even for small changes.

## Documentation Must Stay in Sync

After every implementation, verify that relevant docs are updated:
- `ARCHITECTURE.md` — if the system topology, data model, API routes, or service responsibilities changed
- `doc/` — any feature-level or API docs in scope
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
| `apps/cv-api` | ASP.NET Core 8 | REST API, PDF generation, gRPC client |
| `apps/llm-service` | Python / FastAPI + gRPC | LLM gateway |
| `apps/admin-api` | NestJS | Admin backend |
| `apps/admin-ui` | Next.js | Admin frontend |

Shared library: `libs/auth` (`@ai-cv-maker/auth`) — auth utilities shared by Angular and React.

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
- Auth token stored in `localStorage` via `@ai-cv-maker/auth` constants — do not hardcode key names
- LLM provider is controlled by env vars (`LLM_PROVIDER`, `LLM_MODEL`, etc.) — no code changes needed to switch
- EF Core migrations live in `apps/cv-api/Migrations/` — always generate a migration for schema changes
- gRPC contract is the source of truth in `proto/llm_service.proto`

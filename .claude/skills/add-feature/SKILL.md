---
name: add-feature
description: Add a new feature or change to this project. Use when asked to implement a feature, add functionality, build something new, or make a product change. Orchestrates the full workflow via subagents in a dedicated worktree: user story → spec → tests → implementation → in-browser verification → docs → PR.
---

Nx monorepo: Angular SPA (`apps/ui-angular`), ASP.NET Core API (`apps/cv-api`), Python gRPC LLM service (`apps/llm-service`). All paths below are relative to the repo root.

You are the **orchestrator**. All work happens in a dedicated git worktree (Phase 0). Phases 1–2 you do yourself (they end in user-approval gates). Phases 3–5 are executed by the project subagents in `.claude/agents/` — `test-writer`, `feature-implementer`, `browser-verifier` — spawned with the Agent tool (`subagent_type: <name>`).

**Subagents start with zero context.** Every prompt you send must be self-contained: paste the user story with acceptance criteria, paste the relevant spec section verbatim, and give explicit file paths. Never write "see above" or "as discussed".

Follow the phases in order. **Pause for approval after Phase 1 and Phase 2 before continuing.** Never skip ahead.

---

## Phase 0: Worktree (orchestrator, inline)

All work — story, spec, tests, code — happens in a dedicated worktree on a feature branch, never on `main` in the primary checkout. Skip this phase only if the session is already inside a feature worktree.

1. **Enter it.** Use the `EnterWorktree` tool if available. Otherwise:
   ```bash
   git worktree add ../ai-cv-maker-<slug> -b feature/<slug>
   ```
   and do all subsequent work from that directory using absolute paths. Use a short slug of the request; once the story ID exists (end of Phase 1), rename the branch to `feature/us-<area>-<n>` (`git branch -m`).
2. **One-time setup inside the worktree:**
   - `cp <primary-checkout>/.env .env` — `.env` is gitignored, so a fresh worktree has none and the stack won't boot without it.
   - `npm ci`
   - Python: `apps/llm-service/.venv` self-provisions via the `llm-service:install` nx target on first serve/test. The root `.venv` is only needed for `npm run grpc:generate`; if the feature touches the proto, recreate it: `python3 -m venv .venv && .venv/bin/pip install grpcio-tools`.
   - Docker (postgres) and cv-api user secrets are machine-global and shared — nothing to do.
3. **Pin subagents to the worktree.** Every subagent prompt must state the worktree root explicitly ("repo root: `<worktree path>` — work only there, never in `<primary checkout path>`"). Subagents inherit your cwd, but don't rely on it.

When the feature is done, Phase 7 commits the branch and opens a PR automatically. Leave the worktree in place until the branch is merged; remove it afterwards (`ExitWorktree` or `git worktree remove`).

---

## Phase 1: User Story (orchestrator, inline)

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

Write acceptance criteria as observable user outcomes — the browser-verifier will later check each one literally, in a real browser. A criterion it couldn't check by using the app is too vague.

**Stop here.** Present the user story draft and wait for the user to approve it before moving to Phase 2.

---

## Phase 2: Spec (orchestrator, inline)

If the area of the codebase is unfamiliar, first spawn an **Explore** subagent to map the relevant components, endpoints, and patterns — then write the spec yourself.

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

## Phase 3: Tests — red (subagent: `test-writer`)

Spawn one `test-writer` agent. Its prompt must contain:

- The full user story including acceptance criteria (pasted).
- The full spec section (pasted).
- Which services are affected and therefore which suites to write: Playwright e2e (required for any UI change), cv-api integration tests, llm-service pytest.
- The target test file paths (e.g. `apps/ui-angular/e2e/<area>.spec.ts`).

When it returns, **verify red yourself** — do not take the report on faith:

```bash
npx nx run ui-angular:e2e -- --headed=false 2>&1 | tail -30
cd apps/llm-service && .venv/bin/pytest -x 2>&1 | tail -20   # if llm-service is in scope
```

Confirm the failures are the *new* tests failing for the right reason, and review the diff (`git diff`) to check the tests actually assert the acceptance criteria.

---

## Phase 4: Implementation (subagent: `feature-implementer`, one per service)

Spawn one `feature-implementer` per affected service. Each prompt must contain:

- The service to implement (exactly one: `ui-angular`, `cv-api`, or `llm-service`).
- The full spec section (pasted).
- The failing tests it must turn green (file paths + test names) — with the instruction that tests are the contract and must not be edited.

**Order matters when services share a contract:** proto/`llm-service` → `cv-api` → `ui-angular`, sequentially, so each layer implements against a finished contract below it. Run implementers in parallel only when the services are genuinely independent for this feature.

After each implementer returns:

1. Review its diff (`git diff`) — check scope (only its service touched), conventions, and no test edits.
2. Re-run that service's tests yourself to confirm green.

---

## Phase 5: Verification (subagent: `browser-verifier`)

Never declare the feature done from unit/e2e tests alone, and never ask the user to check manually. The feature must be proven working in a real browser against the real local stack.

1. First re-run the full relevant test suites yourself and confirm green (including the Phase 3 tests).
2. Spawn a `browser-verifier` agent. Its prompt must contain:
   - The worktree root to run the stack from (ports are machine-global — a stack left running from another checkout would serve the wrong code).
   - The acceptance criteria as an explicit checklist.
   - The routes/pages involved and any setup data the flows need.
   - Which criteria involve LLM calls (so it knows where PARTIAL verdicts are acceptable if no provider key is configured).
3. When it reports:
   - **All PASS** → move to Phase 6.
   - **Any FAIL** → fix it: small fixes do inline; service-level rework goes back to a `feature-implementer` with the verifier's repro steps pasted in. Then re-verify via `SendMessage` to the *same* browser-verifier (it keeps its stack, session, and context) rather than spawning a fresh one.
   - Loop until every criterion is PASS (or PARTIAL only for documented LLM-key gaps).
4. Relay the verifier's evidence to the user in your final report: the per-criterion verdict table and screenshots (send them with SendUserFile if available).

---

## Phase 6: Documentation (orchestrator, inline)

Per CLAUDE.md, docs sync is part of the change, not a follow-up:

- `ARCHITECTURE.md` — if topology, data model, API routes, or service responsibilities changed.
- `doc/` — feature-level or API docs in scope.
- `README.md` — if setup, commands, or high-level description changed.

---

## Phase 7: Commit & PR (orchestrator, inline)

Runs automatically once Phase 5 is fully PASS and Phase 6 docs are updated — no extra approval needed (the user approved the scope in Phases 1–2).

1. From the worktree, review `git status` — stage the feature's files deliberately (`git add <paths>`), not `git add -A`, so stray artifacts (screenshots, scratch files) stay out.
2. Commit on the feature branch, matching the repo's convention:
   ```
   <feat|fix>(<area>): <short title> (US-<AREA>-<N>)
   ```
   End the message with the `Co-Authored-By: Claude` line.
3. Push and open the PR:
   ```bash
   git push -u origin feature/us-<area>-<n>
   gh pr create --title "<same as commit title>" --body-file <body.md>
   ```
   PR body (write it to the scratchpad first):
   - **Story:** the US-ID and one-line goal, linking `doc/user-stories/<area>.md` and the spec section.
   - **Changes:** per service, a few bullets.
   - **Verification:** the browser-verifier's criterion → verdict table, plus test-suite results. Note any PARTIAL verdicts and why.
   - The 🤖 Claude Code attribution footer.
4. Report the PR URL to the user as part of the final summary. Do **not** merge — that stays with the user. Keep the worktree until the PR is merged.

If the push or `gh pr create` fails (no network, auth), commit anyway, report the branch name and the error, and give the user the exact commands to finish.

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

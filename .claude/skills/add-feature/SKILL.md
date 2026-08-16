---
name: add-feature
description: Add a new feature or change to this project. Use when asked to implement a feature, add functionality, build something new, or make a product change. Orchestrates the full workflow via subagents in a dedicated worktree: change brief → design → tests → implementation → in-browser verification → docs → PR.
---

Nx monorepo: Angular SPA (`apps/ui-angular`), ASP.NET Core API (`apps/cv-api`), Python gRPC LLM service (`apps/llm-service`). All paths below are relative to the repo root.

You are the **orchestrator**. All work happens in a dedicated git worktree (Phase 0). Phases 1–2 you do yourself (they end in user-approval gates). Phases 3–5 are executed by the project subagents in `.claude/agents/` — `test-writer`, `feature-implementer`, `browser-verifier` — spawned with the Agent tool (`subagent_type: <name>`).

**Subagents start with zero context.** Every prompt you send must be self-contained: paste the acceptance criteria, paste the relevant design-note section verbatim, and give explicit file paths. Never write "see above" or "as discussed".

**Two kinds of artifact.** The *change brief* (Phase 1) and *design note* (Phase 2) are working documents for this change — they live in the scratchpad and end up in the PR body, not in the repo. The permanent artifact is the **feature doc** in `doc/<domain>/`, updated in Phase 6 to describe the new behaviour as it now is. Docs describe the system's present tense; they are never a changelog of increments.

Follow the phases in order. **Pause for approval after Phase 1 and Phase 2 before continuing.** Never skip ahead.

---

## Phase 0: Worktree (orchestrator, inline)

All work — brief, design, tests, code — happens in a dedicated worktree on a feature branch, never on `main` in the primary checkout. Skip this phase only if the session is already inside a feature worktree.

1. **Enter it.** Use the `EnterWorktree` tool if available. Otherwise:
   ```bash
   git worktree add ../ai-cv-maker-<slug> -b feature/<slug>
   ```
   and do all subsequent work from that directory using absolute paths. Use a short slug of the request — e.g. `feature/inline-link-text`, `feature/rename-profile`.
2. **One-time setup inside the worktree:**
   - `cp <primary-checkout>/.env .env` — `.env` is gitignored, so a fresh worktree has none and the stack won't boot without it.
   - `npm ci`
   - Python: `apps/llm-service/.venv` self-provisions via the `llm-service:install` nx target on first serve/test. The root `.venv` is only needed for `npm run grpc:generate`; if the feature touches the proto, recreate it: `python3 -m venv .venv && .venv/bin/pip install grpcio-tools`.
   - Docker (postgres) and cv-api user secrets are machine-global and shared — nothing to do.
3. **Pin subagents to the worktree.** Every subagent prompt must state the worktree root explicitly ("repo root: `<worktree path>` — work only there, never in `<primary checkout path>`"). Subagents inherit your cwd, but don't rely on it.

When the feature is done, Phase 7 commits the branch and opens a PR automatically. Leave the worktree in place until the branch is merged; remove it afterwards (`ExitWorktree` or `git worktree remove`).

---

## Phase 1: Change brief (orchestrator, inline)

Write to the scratchpad as `brief.md`. Not a repo file.

```markdown
# <Short title>

**Goal:** <one or two sentences — what the user can do afterwards that they can't now, and why it matters>

**Feature doc:** doc/<domain>/<file>.md   ← the doc Phase 6 will update

**Acceptance criteria:**
- <observable outcome>
- <observable outcome>
```

Write acceptance criteria as observable user outcomes — the browser-verifier will later check each one literally, in a real browser. A criterion it couldn't check by using the app is too vague. They are also what the test-writer turns into assertions, so they carry the whole change: if a criterion is missing, nothing downstream will catch it.

Name the feature doc now. If the change doesn't fit any existing doc, say which new one it needs and why. If the change is infrastructure, security, or cross-service work with no user-visible behaviour, stop and write an ADR instead — see `doc/adr/README.md`.

**Stop here.** Present the brief and wait for approval before moving to Phase 2.

---

## Phase 2: Design note (orchestrator, inline)

If the area of the codebase is unfamiliar, first spawn an **Explore** subagent to map the relevant components, endpoints, and patterns — then write the design yourself.

**Read the feature doc named in Phase 1 first.** It states how the area behaves today; the design says what changes.

Write to the scratchpad as `design.md`. Not a repo file — its durable half lands in the feature doc in Phase 6.

```markdown
# Design — <Short title>

## Behaviour
What the user sees, per acceptance criterion. Include edge cases and error states.

## API (if a route is new or changed)
`<METHOD> /api/<route>` — request body, success response, error responses with statuses.

## Data model (if the schema changes)
New fields/tables and their types. EF Core migration required for cv-api schema changes.

## gRPC (only if llm-service is involved)
Proto changes needed in `proto/llm_service.proto` — the contract source of truth.
Regenerate with `npm run grpc:generate`.

## Frontend
New or changed components, services, routes; which app (`ui-angular`,
`profile-builder-ui`, `chat-ui`, `chrome-extension`).

## Doc impact
Which sections of the feature doc Phase 6 rewrites, and whether ARCHITECTURE.md
or README.md is affected.

## Out of scope
Explicitly deferred items — these become the feature doc's "Not implemented" entries.
```

Keep it at the altitude a subagent needs to implement without guessing, and no lower. Don't restate what the code already says.

**Stop here.** Present the design and wait for approval before moving to Phase 3.

---

## Phase 3: Tests — red (subagent: `test-writer`)

Spawn one `test-writer` agent. Its prompt must contain:

- The acceptance criteria from the brief (pasted).
- The full design note (pasted).
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

- The service to implement (exactly one: `ui-angular`, `cv-api`, `llm-service`, or a widget app).
- The full design note (pasted).
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

Per CLAUDE.md, docs sync is part of the change, not a follow-up. This is where the change becomes permanent knowledge.

**Update the feature doc named in Phase 1 so it describes the system as it now is.** Rewrite the affected sections in the present tense — do not append a section describing "the new feature". A reader must not be able to tell from the doc that this behaviour arrived later than the rest.

- Move Phase 2's out-of-scope items into the doc's **Not implemented** section.
- If behaviour the doc described is now gone, delete those sentences. If a whole approach was replaced, the doc describes only the replacement, with the reasoning in an ADR.
- Add cross-links to related feature docs and to any ADR that explains a decision.

Also update, when in scope:

- `ARCHITECTURE.md` — if topology, data model, API routes, or service responsibilities changed.
- `README.md` — if setup, commands, or high-level description changed.
- `doc/adr/` — a new ADR if the change rests on a decision worth recording (see `doc/adr/README.md`).

---

## Phase 7: Commit & PR (orchestrator, inline)

Runs automatically once Phase 5 is fully PASS and Phase 6 docs are updated — no extra approval needed (the user approved the scope in Phases 1–2).

1. From the worktree, review `git status` — stage the feature's files deliberately (`git add <paths>`), not `git add -A`, so stray artifacts (screenshots, scratch files, the scratchpad brief/design) stay out.
2. Commit on the feature branch, matching the repo's convention:
   ```
   <feat|fix>(<area>): <short title>
   ```
   `<area>` matches the feature doc — e.g. `profile-editing`, `job-profiles`, `billing`. End the message with the `Co-Authored-By: Claude` line.
3. Push and open the PR:
   ```bash
   git push -u origin feature/<slug>
   gh pr create --title "<same as commit title>" --body-file <body.md>
   ```
   PR body (write it to the scratchpad first):
   - **Goal:** the one-line goal from the brief, linking the updated feature doc.
   - **Acceptance criteria:** the checklist from the brief — this is where they live permanently.
   - **Changes:** per service, a few bullets.
   - **Verification:** the browser-verifier's criterion → verdict table, plus test-suite results. Note any PARTIAL verdicts and why.
   - The 🤖 Claude Code attribution footer.
4. Report the PR URL to the user as part of the final summary. Do **not** merge — that stays with the user. Keep the worktree until the PR is merged.

If the push or `gh pr create` fails (no network, auth), commit anyway, report the branch name and the error, and give the user the exact commands to finish.

---

## Conventions

- API routes: `/api/job-profiles/:id/<action>` — follow existing REST patterns
- JWT required on all non-auth API routes
- gRPC is the transport between cv-api and llm-service in all environments
- Angular: standalone components, reactive forms, no NgModules
- The block-tree document model is mirrored in three places — `apps/profile-builder-ui/src/model.ts`, `apps/cv-api/Domain/Entities/ProfileDocumentSchema.cs`, `apps/llm-service/app/schemas.py` — and they change together

## Feature docs

| Doc | Area |
|---|---|
| `doc/web-client/authentication.md` | Registration, login, Google sign-in, sessions |
| `doc/web-client/job-profiles.md` | Profile CRUD, CV import |
| `doc/web-client/profile-editing.md` | Document editor, block-tree model, widgets |
| `doc/web-client/chat.md` | AI assistant — global and in-editor |
| `doc/web-client/cv-generation.md` | CV generation, PDF rendering |
| `doc/web-client/ai-usage.md` | Token metering, cost, limits, caching, observability |
| `doc/web-client/billing.md` | Balance, top-ups, payment channels |
| `doc/web-client/settings.md` | Global AI preferences |
| `doc/web-client/developer-experience.md` | Dev shell, theme library |
| `doc/chrome-extension/auto-fill.md` | Extension: fill, CV download, side panel |
| `doc/admin/users.md` | Admin panel and admin-api |

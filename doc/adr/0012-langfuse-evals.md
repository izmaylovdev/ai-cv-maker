# ADR-0012: Run LLM evals through Langfuse datasets and experiments

- **Status:** Accepted (amended by [ADR-0021](0021-firestore-replaces-cloud-sql.md) to that extent: production Langfuse now needs an externally provisioned Postgres; local `npm run evals` against the compose overlay is unaffected)
- **Date:** 2026-06-17

## Context

`llm-service` ships an offline eval suite (`apps/llm-service/evals/`) that runs
each LLM operation (generate, optimize, enhance, extract, security, and the
preference-aware variants) against curated fixtures, scores the outputs with
deterministic checks and LLM-as-judge evaluators, and enforces a quality gate
(non-zero exit when an aggregate score falls below threshold) so the suite can
run in CI and locally.

Until now this was orchestrated by the **Azure AI Evaluation SDK**
(`azure-ai-evaluation`'s `evaluate()`), which loaded JSONL fixtures, called the
targets, ran the evaluators, wrote `evals/results/<op>_latest.json`, and — only
when `AZURE_AI_PROJECT_ENDPOINT` was set — logged runs to the Azure AI Foundry
portal.

ADR-0010 adopted **self-hosted Langfuse** as the LLM observability backend, and
all live model calls already trace to it. That left two separate observability
systems: live traces in Langfuse, eval runs in the Azure AI Foundry portal.
Reviewing eval results meant a different tool, a different account, and a
third-party SaaS (the same data-residency concern ADR-0010 rejected for live
traffic — eval fixtures and completions are representative career data).

Langfuse has first-class **Datasets** and **Experiments**
(`langfuse.run_experiment`, already available in the pinned `langfuse>=3,<4`):
a dataset holds versioned items, an experiment runs a task over them, item- and
run-level evaluators attach scores, and every execution is traced and comparable
across runs in the same UI we already operate.

Constraints that shaped the decision:

- Fixtures must stay **version-controlled** in the repo — they are reviewed in
  PRs alongside the prompts they guard.
- The suite must keep a **local quality gate** (non-zero exit on threshold
  breach) so CI and pre-deploy checks fail loudly without depending on the UI.
- One observability backend, not two. No eval data should leave our GCP project.

## Decision

We will run all `llm-service` evals through **Langfuse datasets and
experiments** and **remove the `azure-ai-evaluation` dependency** and its
`AZURE_AI_PROJECT_*` configuration.

- **Fixtures stay in the repo** (`evals/fixtures/*.jsonl`) as the source of
  truth. On each run the suite **upserts** them into a Langfuse dataset named
  `eval-<operation>`, using a content-derived stable item id so re-runs dedupe
  rather than duplicate.
- Each operation runs via `Langfuse.run_experiment(data=dataset.items, ...)`,
  producing a dataset run that is traced and comparable in the Langfuse UI.
- Existing **targets** are reused. **Evaluators** (deterministic
  extraction-accuracy checks and the Claude-as-judge quality / on-task /
  preference-adherence scorers) are adapted to the Langfuse evaluator contract
  and emit `Evaluation` scores; the thresholds are unchanged. Each score carries
  a rationale `comment` (the judge's reasoning, or the deterministic
  expected-vs-got detail) and `{operation, model}` metadata so the Langfuse
  scores table is self-explanatory rather than a column of bare numbers. Each
  operation's run sets the Langfuse tracing environment to `eval-<operation>`,
  surfacing the operation as the sortable/filterable **Environment** column on
  scores and traces (the scores table has fixed columns, so a metadata key alone
  cannot be promoted to its own column).
- The **quality gate is preserved**: aggregate scores are computed as run-level
  evaluations, compared against the existing per-operation thresholds, and the
  process exits non-zero on any breach. A local `evals/results/<op>_latest.json`
  is still written for CI artifacts and offline inspection, now including the
  Langfuse dataset-run URL.
- Running evals **requires Langfuse credentials** (`LANGFUSE_PUBLIC_KEY`,
  `LANGFUSE_SECRET_KEY`, `LANGFUSE_HOST`). This differs from live tracing, which
  is opt-in/no-op (ADR-0010): evals are a deliberate, manually-invoked activity
  whose entire purpose is to record results in Langfuse, so the suite fails fast
  with a clear message when unconfigured rather than silently running untracked.

## Alternatives considered

- **Keep Azure AI Evaluation, add Langfuse logging alongside.** Two eval
  backends to maintain, eval data still leaving our project to Azure Foundry,
  and the split-brain problem (live vs. eval observability) persists. Rejected:
  contradicts the single-backend, data-residency goals of ADR-0010.
- **Langfuse datasets as the source of truth (edit fixtures in the UI).**
  Fixtures would no longer be git-versioned or reviewable in PRs, and would
  drift from the prompts they guard. Rejected in favour of repo JSONL upserted
  into Langfuse on each run.
- **Make eval runs opt-in/no-op like live tracing.** Mirrors ADR-0010, but an
  eval run that silently produces no recorded results is a footgun for the one
  workflow whose point is recording results. Rejected in favour of fail-fast
  when credentials are absent.
- **Drop the local quality gate and read pass/fail from the Langfuse UI.**
  Removes automated CI enforcement and couples the gate to UI/network
  availability. Rejected: the gate stays in the runner.

## Consequences

- **Easier:** one observability backend for both live traffic and evals; eval
  runs are traced, versioned, and comparable across runs in Langfuse; eval data
  stays inside our GCP project.
- **Harder / new obligations:**
  - Running evals now requires Langfuse credentials in the environment; there is
    no Azure-portal or backend-less path.
  - Datasets in Langfuse are upserted from repo fixtures; the repo remains
    authoritative, and stale items removed from JSONL are not auto-pruned from
    the dataset (items only ever upsert).
  - `azure-ai-evaluation` and `AZURE_AI_PROJECT_ENDPOINT` are removed; anyone
    relying on Foundry-portal eval logging must use Langfuse instead.
- **Privacy:** consistent with ADR-0010 — eval fixtures and completions stay in
  the self-hosted Langfuse inside our infrastructure.
- **Revisit if:** Langfuse's dataset/experiment API changes incompatibly across
  a major version, or eval volume warrants a dedicated offline harness separate
  from the live-tracing backend.

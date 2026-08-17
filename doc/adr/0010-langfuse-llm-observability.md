# ADR-0010: Langfuse for LLM observability

- **Status:** Accepted (amended by [ADR-0021](0021-firestore-replaces-cloud-sql.md) to that extent: Langfuse cannot run on Firestore, so enabling it in production now requires provisioning a Postgres for it first)
- **Date:** 2026-06-16

## Context

Every model call in the platform funnels through `llm-service`, but once a call
leaves the gRPC handler we have almost no visibility into it. Today we capture
only token counts (`UsageMetadata` returned over gRPC, persisted as
`LlmUsage`) and coarse Prometheus latency histograms (`grpc_server_handled_seconds`).
We cannot see the actual prompts and completions, per-operation cost, latency
broken down by provider, or why a given generation produced bad output. When a
user reports "the CV it generated was wrong", there is no trace to inspect.

The service also has two distinct invocation paths that must both be observable:

- **LangChain path** — `google`, `openai`/`openai_compatible`, `azure_openai`
  providers, via `_build_llm()` → `llm.ainvoke()`.
- **Direct Anthropic SDK path** — `anthropic`, `foundry`/`azure_foundry`
  providers, via `AsyncAnthropic(...).messages.create()`.

cv-api already assigns each HTTP request a correlation id (`TraceContext.TraceId`)
and records `RequestSpan` rows for the HTTP request and each gRPC call. LLM
traces should tie back to that id and to the authenticated user so an LLM trace
can be correlated with the originating API request.

Constraints that shaped the decision:

- Prompts and completions are user career data. We do not want that content
  leaving our infrastructure to a third-party SaaS.
- Local development, CI, and tests must keep working with **no** observability
  backend configured — instrumentation cannot become a hard dependency.
- The LLM provider is already env-driven (ADR-style: no code change to switch);
  observability config should follow the same convention.

## Decision

We will adopt **Langfuse** as the LLM observability backend and **self-host it
on GCP** (its own Cloud Run service plus the datastores Langfuse requires),
alongside the existing platform services. No prompt/completion content leaves our
GCP project.

Instrumentation lives in **`llm-service`**, the single choke point for all model
calls. Both invocation paths are traced:

- LangChain path: a Langfuse `CallbackHandler` is attached per call.
- Direct Anthropic path: each call is wrapped in a Langfuse generation span with
  model name and token usage recorded.

Tracing is **opt-in and no-op when unconfigured**. Langfuse is activated only
when its credentials (`LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`,
`LANGFUSE_HOST`) are present in the environment. With no credentials, the client
is never constructed and every instrumentation point degrades to a no-op with
zero behavioural change — so local dev, CI, and tests are unaffected.

**cv-api propagates trace context to llm-service** over gRPC metadata (not proto
fields, since it is cross-cutting and applies to every RPC): the existing
`TraceContext.TraceId` and the authenticated user id are attached as metadata
headers on every llm-service call, next to the existing `Authorization` header
(ADR-0001). A server interceptor in llm-service reads these headers and binds
them to the trace, so each Langfuse trace carries the cv-api correlation id and
`user_id`. This links a Langfuse LLM trace to the cv-api `RequestSpan` rows for
the same request.

## Alternatives considered

- **Langfuse Cloud (managed SaaS).** Fastest to stand up and zero infra to
  operate, but prompts/completions (user career data) would leave our GCP
  project to a third party. Rejected on data-residency grounds.
- **OpenTelemetry traces to an existing/generic backend** (e.g. Cloud Trace).
  We already emit Prometheus metrics, and generic tracing would cover latency.
  But it has no first-class concept of a "generation" (prompt, completion,
  model, token cost, evaluation) and no UI for inspecting prompt/response pairs,
  which is the actual gap. Rejected as not fit for LLM debugging.
- **Always-on / required Langfuse in every environment.** Gives a stronger
  guarantee that nothing is untraced, but breaks local dev, CI, and tests when
  credentials are absent and couples the service to an extra dependency at
  startup. Rejected in favour of opt-in/no-op.
- **Propagate trace context as proto fields** on each request message. Would
  pollute every request/response type with cross-cutting concerns and require a
  proto change touching all RPCs. Rejected in favour of gRPC metadata, which is
  the idiomatic transport for cross-cutting context (already used for auth).
- **Instrument cv-api instead of / in addition to llm-service.** cv-api does not
  make model calls directly; llm-service is the single point where prompts and
  completions exist. cv-api's role is limited to propagating correlation context.

## Consequences

- **Easier:** inspecting real prompt/completion pairs, per-operation and
  per-provider latency/cost, and debugging bad generations. LLM traces correlate
  with cv-api requests and users via the shared trace id.
- **Harder / new obligations:**
  - We must operate a self-hosted Langfuse deployment (service + its datastores),
    including upgrades and backups. Standing up that infrastructure is a
    follow-up ops task; the code change here is host-agnostic and targets
    whatever `LANGFUSE_HOST` is configured.
  - Langfuse credentials become managed secrets (per ADR-0002).
  - A new Python dependency (`langfuse`) in llm-service.
- **Privacy:** because traces contain full prompts and completions (user career
  data), the backend must stay inside our infrastructure and access-controlled.
  This is the reason self-hosting was chosen over Cloud.
- **Revisit if:** the operational cost of self-hosting outweighs the benefit, or
  a data-processing agreement makes Langfuse Cloud acceptable — at which point
  only `LANGFUSE_HOST` and the credentials change, not the instrumentation code.

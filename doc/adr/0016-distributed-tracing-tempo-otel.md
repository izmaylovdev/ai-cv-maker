# ADR-0016: Distributed tracing with OpenTelemetry and Grafana Tempo

- **Status:** Accepted
- **Date:** 2026-06-25

## Context

Request observability used a homegrown `RequestSpans` table in the main
Postgres database. `RequestTracingMiddleware` wrote one row per HTTP request and
`LlmService` appended a flat gRPC row sharing a `TraceId` (a per-request GUID).
Grafana rendered these as Postgres table panels.

This gave a *list* of requests but never a *trace*: the `RequestSpan` entity has
no `SpanId`/`ParentSpanId`, so there is no parent/child hierarchy and no way to
render a span waterfall or see where time is spent within a request. The trace
context also stopped at the gRPC boundary — the cv-api correlation id was passed
to llm-service only as Langfuse metadata (ADR-0010, `x-trace-id`), never as a
real propagated trace, so cv-api spans and llm-service work could not be viewed
as one trace. Storing spans in the application database also coupled an
operational concern to the product schema and its migrations.

We wanted to click a request and see the full cross-service span tree
(HTTP → gRPC client → llm-service handler → LLM call) with timings and status.

## Decision

We will instrument cv-api and llm-service with **OpenTelemetry** and export
spans over OTLP to a **Grafana Tempo** backend, viewed through Grafana's native
Traces visualization.

- cv-api uses the OpenTelemetry .NET SDK with ASP.NET Core and gRPC-client
  instrumentation. The gRPC client injects W3C `traceparent` into call metadata,
  so trace context propagates to llm-service automatically.
- llm-service adds the OpenTelemetry gRPC **server** interceptor, which extracts
  `traceparent` from incoming metadata so its spans nest under the cv-api trace,
  and exports over OTLP.
- Both services are **gated on `OTEL_EXPORTER_OTLP_ENDPOINT`**: with the variable
  unset, tracing is a no-op (no exporter registered), mirroring the opt-in
  Langfuse pattern so plain local dev, CI, and tests are unaffected.
- The `RequestSpans` table, `RequestSpan` entity, `RequestTracingMiddleware`,
  and `TraceContext` are **removed**; a migration drops the table. Grafana's
  three Postgres trace panels are replaced with Tempo TraceQL panels.
- Scope is **local dev only**. Tempo runs in docker-compose (base stack and the
  `--with-obs` overlay). Production tracing on Cloud Run is out of scope and, if
  pursued, will be a follow-up ADR.
- Langfuse (ADR-0010) is unchanged and remains the LLM-content-focused tool; the
  `x-trace-id` / `x-user-id` gRPC metadata it relies on is still sent, now
  sourced from the active OpenTelemetry trace id so Langfuse and Tempo correlate.

## Alternatives considered

- **Keep `RequestSpans`, add a Postgres drill-down panel.** Cheapest, but the
  flat model can never show a real waterfall (no span hierarchy) and keeps
  operational data in the product DB. Rejected — does not deliver the goal.
- **Jaeger instead of Tempo.** Equivalent tracing capability, but Tempo is a
  Grafana-native datasource that drops into the existing Grafana stack with no
  second UI, and shares the Prometheus/Grafana operational story already in use.
- **Grafana Cloud / hosted tracing.** Unnecessary for a local-dev scope and adds
  an external dependency and credentials. Revisit if production tracing is taken
  on.
- **Keep `x-trace-id` as the only propagation.** It is application-specific,
  unary-only, and carries no span hierarchy or timing. Standard W3C
  `traceparent` via OTel instrumentation is automatic and tool-agnostic.

## Consequences

- A request can be opened in Grafana as a single cross-service waterfall with
  per-span timings and error status — the original goal.
- The product database no longer stores spans; one fewer table and migration
  concern coupled to operations.
- New operational dependency for local observability: the Tempo container plus
  `monitoring/tempo/tempo.yaml`. Tempo uses local block storage with short
  retention (dev only); trace data is disposable.
- New obligation: when adding a service or an outbound call worth tracing,
  instrument it with OpenTelemetry rather than writing rows to a table.
- Production still has no distributed tracing (Cloud Trace/Langfuse only). This
  should be revisited (new ADR) if cross-service latency debugging is needed in
  prod.
- Revisit if Tempo's footprint becomes a burden for contributors who only want
  the app, or if production tracing requires a shared backend.

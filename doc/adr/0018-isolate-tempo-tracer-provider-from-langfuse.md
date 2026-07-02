# ADR-0018: Isolate the Tempo tracer provider from Langfuse

- **Status:** Accepted
- **Date:** 2026-07-02

## Context

llm-service runs two OpenTelemetry-based observability integrations side by side:

- **Tempo distributed tracing** (ADR-0016): `app.tracing.configure_tracing`
  builds an SDK `TracerProvider` with an OTLP exporter and installs the
  OpenTelemetry gRPC **server** interceptor, which emits one span per RPC named
  after the full method (e.g. `/llm.LlmService/Chat`).
- **Langfuse LLM observability** (ADR-0010): `app.observability` builds a
  Langfuse client and opens a rich root trace per RPC (`rpc_span`, named `Chat`)
  with the LLM generation and token usage nested inside.

`configure_tracing` registered its Tempo provider as the process-wide **global**
tracer provider (`trace.set_tracer_provider`). The Langfuse v3 SDK is itself
built on OpenTelemetry and attaches its span processor to the global provider.
The consequence: every span created through the global provider — including the
content-less gRPC instrumentation span meant only for Tempo — was also exported
to Langfuse. Each real request therefore produced **two** Langfuse traces: the
intended rich `Chat` trace, and an empty duplicate whose sole observation was the
gRPC method path with no input, output, or generation. The duplication was
present for every traced RPC and cluttered the Langfuse project.

## Decision

We will keep the Tempo `TracerProvider` **local** and never register it as the
global tracer provider. `configure_tracing` passes the provider explicitly to the
gRPC server interceptor (`aio_server_interceptor(tracer_provider=_provider)`).

This confines Tempo instrumentation spans to the Tempo exporter and leaves the
global tracer provider for Langfuse to own exclusively, so Langfuse only ever
records the traces it creates through its own API. Tempo↔Langfuse correlation is
unchanged: it was never dependent on a shared provider — `observability.rpc_span`
seeds the Langfuse trace id from the propagated `x-trace-id` (ADR-0016).

## Alternatives considered

- **Filter spans on the Langfuse side.** Add a sampler/processor that drops
  non-Langfuse spans. More moving parts and Langfuse-version-specific; provider
  isolation removes the leak at the source instead of masking it downstream.
- **Give Langfuse its own explicit provider and leave Tempo global.** Symmetric
  in principle, but the gRPC instrumentation defaults to the global provider, so
  making Tempo global is exactly what pulls instrumentation spans into whatever
  else hooks the global provider. Keeping Tempo local is the smaller, safer change.
- **Stop running Tempo and Langfuse together.** They serve different purposes
  (span waterfall vs. LLM content); dropping either loses real capability.

## Consequences

- Langfuse shows exactly one trace per RPC — the rich one. No empty duplicates.
- Any future llm-service code that expects a *global* OTEL tracer provider for
  Tempo must instead use the provider returned/held by `app.tracing` (there is no
  global Tempo provider by design). New obligation captured here so the absence of
  a global provider is not mistaken for a bug.
- Behaviour is unchanged when either backend is disabled (both remain opt-in via
  their env vars), and Tempo waterfalls are unaffected.
- Revisit if a future integration genuinely needs a shared global provider across
  both backends, or if the Langfuse SDK changes how it discovers a provider.

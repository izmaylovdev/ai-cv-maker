# AI Usage, Cost and Limits

Every LLM call is metered, priced, and charged against a per-user allowance. This
is the accounting layer behind the AI features — the features themselves are
documented in [chat.md](chat.md) and [cv-generation.md](cv-generation.md).

**Code:** `apps/cv-api/Features/Usage/`, `apps/llm-service/app/chains/usage.py`, `proto/llm_service.proto`
**See also:** [billing.md](billing.md) (what the user sees and how they top up) ·
[ADR-0010](../adr/0010-langfuse-llm-observability.md) /
[ADR-0012](../adr/0012-langfuse-evals.md) (observability) ·
[ADR-0019](../adr/0019-anthropic-prompt-caching.md) (prompt caching) ·
[ADR-0024](../adr/0024-anthropic-sdk-2-default-sampling.md) (Anthropic SDK 2.x, default sampling) ·
[ADR-0016](../adr/0016-distributed-tracing-tempo-otel.md) (tracing)

---

## Metering

Every gRPC response from llm-service carries a `UsageMetadata` message:
`prompt_tokens`, `completion_tokens`, `model_name`, `cache_read_tokens`,
`cache_write_tokens`. cv-api writes one document to the top-level `llmUsage` collection per call —
`userId` (nullable, for system calls), `operation`, the four token counts,
`modelName`, `createdAt`. Records where all four counts are zero are skipped
rather than stored.

Cost is **not** stored. It is computed on read from the `LlmPricing` price table
in `appsettings.json`, keyed by model name:

| Setting | Meaning |
|---|---|
| `PromptCostPer1M` | USD per million prompt tokens |
| `CompletionCostPer1M` | USD per million completion tokens |
| `CacheReadCostPer1M` | Optional; defaults to `0.1 × PromptCostPer1M` |
| `CacheWriteCostPer1M` | Optional; defaults to `1.25 × PromptCostPer1M` |

Unknown models fall back to a configurable default entry. Because pricing is
applied at read time, correcting the table re-prices history.

---

## The spending guard

`UsageService.EnsureWithinLimitAsync(userId)` runs **before** every LLM call —
generate, generate-auto, extract, chat, user chat, cover letter. A blocked
request therefore makes no LLM call and records no usage row.

The rule is deliberately simple: block when *accrued* cost has already reached the
allowance. A user still under the limit is allowed through even if that call
overshoots, because the pending call's cost cannot be known in advance. Calls with
no user (system calls) are exempt.

The **effective allowance** resolves in order:

1. the user's `BillingAccount.AllowanceUsd`, if a row exists;
2. otherwise the configured `Billing:DefaultAllowanceUsd`, when set;
3. otherwise the global admin-configurable limit — the `LlmUsageLimitUsd`
   document in the `appSettings` collection (the setting key *is* the document
   id), falling back to `UsageLimit:MaxCostUsdPerUser` in `appsettings.json`
   (default **$0.50**).

A blocked call surfaces as **HTTP 402** with a stable machine-readable body:

```json
{ "code": "usage_limit_exceeded", "message": "…", "limitUsd": 0.50 }
```

`UsageLimitExceptionHandler` produces it centrally, and the Angular
`apiInterceptor` recognises the code and shows a distinct "spending limit
reached" message rather than the generic AI-failure toast — from any AI action,
without each component handling it.

Admins read and change the global limit through `GET`/`PUT /api/admin/usage-limit`
(API-key auth, [ADR-0005](../adr/0005-admin-api-via-cv-api.md)), proxied by
admin-api and exposed in admin-ui. A non-positive or non-numeric value is
rejected with `400`. The limit is global, not per-user.

---

## Prompt caching

On the Anthropic path (providers `anthropic`, `foundry`, `anthropic_foundry`,
`azure_foundry`) every chain — chat, generate, extract, user_chat, job_chat,
cover_letter, profile_selector — sends its system prompt as a content-block list
whose last block carries `cache_control: {"type": "ephemeral"}`.

The editor chat chain goes further to keep the conversation prefix byte-stable
across turns: the profile document travels in a **second** system block after the
instruction block, and `messages` carry only what the client echoes back. Two
breakpoints are applied per request — one on the document block, one on the last
content block of the final message — and re-applied on every tool-loop iteration.
Earlier messages are never mutated. Follow-up turns then reuse the cached prefix;
applying an edit changes the document block and re-warms from there.

The document is embedded as compact JSON (`exclude_none`, no indent).

Non-Anthropic providers (google, openai, azure_openai) see no `cache_control`
anywhere, record zero cache counts, and price exactly as before.

---

## Sampling

llm-service talks to Claude through the `anthropic` Python SDK 2.x, which sends API
version `2026-10-21`. That API version rejects `temperature`, `top_p` and `top_k`
on every model, so Anthropic-path requests carry none of them and sample at the
API default. This applies to every chain, including CV extraction and profile
selection, and to the eval judge. `LLM_TEMPERATURE` (default 0.4) applies only to
the LangChain providers (google, openai, azure_openai). See
[ADR-0024](../adr/0024-anthropic-sdk-2-default-sampling.md).

Contract tests in `apps/llm-service` drive a real SDK client over a mocked
transport through every Anthropic chain. They fail if a request carries a
sampling parameter or a different `anthropic-version`.

---

## Observability

Langfuse traces carry the authenticated `user_id`. A chat conversation is grouped
into a Langfuse **Session**: the chat widget mints one `crypto.randomUUID()` per
mount and sends it with every message; cv-api forwards it as gRPC metadata
`x-session-id`, alongside `x-trace-id` and `x-user-id`. A page reload starts a new
session. A missing session id is a no-op — traces are produced without one, so
older clients keep working — and when Langfuse is not configured nothing
observability-related runs at all.

Anthropic-path generations additionally report `cache_read_input_tokens` and
`cache_creation_input_tokens` in `usage_details`, and list `max_tokens` as their
only model parameter.

---

## Where the numbers surface

`GET /api/billing` is the only place usage numbers are served today: allowance,
spend, remaining balance, and token totals for the signed-in user (see
[billing.md](billing.md)). There is no separate `/api/usage` endpoint and no
standalone usage page — both were removed when the billing summary took over.

`UsageService.GetAllUserSummariesAsync()` computes per-user aggregates for admins
(prompt, completion and cache tokens, estimated cost USD) but **is not currently
exposed by any controller** — cv-api's admin surface is `GET /api/admin/users`
and `GET`/`PUT /api/admin/usage-limit` only. Wiring it up is a small change; the
query already exists.

---

## Removed features

Single-field enhancement, whole-profile optimization, and job-posting-URL
optimization once lived here. They were removed by
[ADR-0015](../adr/0015-remove-optimize-enhance-endpoints.md) — the chat assistant
replaced them. Side-by-side "review suggestions before applying" was specified but
never built; the chat's propose-and-apply flow covers the need.

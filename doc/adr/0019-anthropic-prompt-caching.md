# ADR-0019: Anthropic prompt caching and cache-aware usage accounting

- **Status:** Proposed
- **Date:** 2026-07-10

## Context

Every LLM request from llm-service re-sends its full prompt at full input-token
price. The in-editor chat is the worst case: each turn re-sends the standing
system prompt (~1K tokens of rules + document schema), the entire profile
document as pretty-printed JSON, and up to 20 turns of history — and the
US-AI-13 tool loop re-sends the whole growing message list on every iteration
(up to 4 per request). Input tokens dominate spend, and most of every request
is a byte-identical repeat of the previous one.

Anthropic's prompt caching bills a cached-prefix read at ~0.1× the input price
(a cache write costs 1.25×; with the 5-minute TTL two requests already break
even). Production runs `claude-haiku-4-5` through Azure AI Foundry
(`LLM_PROVIDER=foundry`), where prompt caching is **beta**; the same
`cache_control` request shape is GA on the first-party Anthropic API.

Constraints discovered while designing this:

- **Caching changes what `input_tokens` means.** Once a prefix is cached,
  Anthropic reports it in `cache_read_input_tokens` / `cache_creation_input_tokens`
  and `input_tokens` holds only the uncached remainder. Our accounting
  (`TokenUsage` → gRPC `UsageMetadata` → cv-api `LlmUsage` → `Summarize()`
  pricing, plus Langfuse `usage_details`) only knows prompt/completion tokens.
  Enabling caching without extending accounting would silently under-count
  prompts and under-charge users. Caching and accounting must ship together.
- **Minimum cacheable prefix on Haiku 4.5 is 4096 tokens.** System prompts
  alone are below it; system + profile document clears it easily. A too-short
  prefix silently doesn't cache — no error, no write charge.
- Caches are prefix-matched: any byte change invalidates everything after it.
  Volatile content must stay after the last breakpoint; the pretty-printed
  (`indent=2`) profile JSON wastes prefix bytes for no model benefit.

## Decision

We will:

1. **Mark cacheable prefixes on every Anthropic-path request** (chains routed
   via `provider in ("anthropic", "foundry", ...)`), using
   `cache_control: {"type": "ephemeral"}` (5-minute TTL):
   - all chains: the system prompt, sent as a content-block list with the
     breakpoint on its last block;
   - the editor chat chain additionally: the profile document moves out of the
     per-turn user message into a second `system` block (with its own
     breakpoint), and `messages` carry only the raw user/assistant texts that
     the client echoes back as history. This is what makes the conversation
     prefix byte-stable across turns — in-browser verification proved the
     original design (document embedded in each turn's final user message)
     never produced a cross-turn cache hit, because turn N's cached suffix was
     not a prefix of turn N+1's messages. A third breakpoint sits on the final
     message's last content block so tool-loop iterations inside one request
     also reuse the prefix. Applying an edit changes the document block and
     re-warms the cache from there — correct, since the document genuinely
     changed.
   Three breakpoints maximum per request (API allows 4).
2. **Compact the chat prompt's profile JSON** — drop `indent=2` from
   `model_dump_json` in the chat chain's prompt builder (~10–20% fewer
   document tokens and a smaller prefix to cache).
3. **Extend usage accounting end-to-end** with two new counts,
   `cache_read_tokens` and `cache_write_tokens`:
   `TokenUsage` (llm-service) → `UsageMetadata` proto fields 4/5 (additive,
   wire-compatible) → `LlmTokenUsage` / `LlmUsage` entity + EF migration
   (cv-api) → `Summarize()` prices cache reads at 0.1× and cache writes at
   1.25× of the model's `PromptCostPer1M` unless explicit
   `CacheReadCostPer1M` / `CacheWriteCostPer1M` values are configured in
   `LlmPricing`. Langfuse generations report the same counts via
   `usage_details` (Anthropic key names, which Langfuse prices natively).
4. **Leave non-Anthropic providers untouched.** The LangChain (google/openai)
   paths never see `cache_control`; their new counts are always zero and their
   pricing math is unchanged.

Rollout note: if Foundry's beta caching turns out not to honor `cache_control`
(observable as `cache_read_input_tokens` staying zero), behaviour and billing
remain correct — the fallback is switching `LLM_PROVIDER=anthropic`
(first-party, caching GA), an env-only change.

## Alternatives considered

- **1-hour TTL caching** — write cost doubles (2×), needing ≥3 reads to break
  even. Chat turns arrive seconds-to-minutes apart, comfortably inside the
  5-minute TTL; rejected as strictly worse for this traffic shape.
- **Message Batches API (50% off)** — all our flows are interactive
  request/response; Batches are also unavailable on Foundry. Only future fit
  is offline evals. Rejected for product traffic.
- **Cheaper model** — already on Haiku 4.5, the cheapest current Claude tier.
  No lever here.
- **Enable caching without accounting changes** — rejected outright: cached
  reads would be either invisible (under-charging, since `input_tokens`
  excludes them) or, if naively added into `prompt_tokens`, charged at ~10×
  their real cost.
- **Charging cache writes at base input price** (ignoring the 1.25× premium) —
  rejected; the premium is real and the multiplier is one line of code.
- **Cache-friendly history trimming** (trim in chunks so the sliding 20-turn
  window doesn't invalidate the prefix every turn at the cap) — deferred as a
  follow-up; valuable but independent of this change.

## Consequences

- Multi-turn chat input spend drops by roughly 60–80% for typical sessions;
  tool-loop iterations inside a single request become near-free on the prefix.
- `EstimatedCostUsd` stays honest under caching, and per-user allowances
  (US-AI-14) deplete at the true discounted rate.
- New obligation: pricing config gains optional cache-rate fields; any future
  model entry should either rely on the 0.1×/1.25× fallback or set them
  explicitly.
- New obligation: cache hit rate is now an operational metric — Langfuse
  `usage_details` is the place to watch it; `cache_read_input_tokens` stuck at
  zero on repeated requests means a silent invalidator (or Foundry beta gap).
- The `LlmUsages` table gains two int columns (migration; existing rows
  default to 0, which is historically accurate).
- Revisit triggers: switching default provider/model (different minimum
  cacheable prefix and pricing), Foundry caching leaving beta, or adopting
  models that reject `temperature` (Sonnet 5 / Opus 4.7+) where the request
  builder needs a second look anyway.

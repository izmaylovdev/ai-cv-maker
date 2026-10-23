# ADR-0024: Anthropic SDK 2.x; Anthropic calls sample at the API default

- **Status:** Accepted
- **Date:** 2026-10-23

## Context

llm-service calls Claude through the `anthropic` Python SDK on every Anthropic-path
provider (`anthropic`, `foundry`, `anthropic_foundry`, `azure_foundry`). Every chain
passed `temperature`: `LLM_TEMPERATURE` (0.4 in production, on `claude-haiku-4-5`)
for generation and the chat chains, and `0` for CV extraction, profile selection
and the eval judge.

The SDK moved on under that code:

- 1.x removed `temperature`, `top_p` and `top_k` from `messages.create` /
  `.stream`. An unbounded pin resolved 1.x and every call raised `TypeError`,
  so the service was capped at `<1`.
- 2.0.0 (2026-10-21) sends API version `2026-10-21` by default. On that version
  the API returns a 400 for any Messages request that carries one of the three
  parameters, on every model and even at the default value.
- The newer models (Haiku 5.5, Sonnet 5.5 and later) already reject non-default
  sampling values on the old API version too.

Staying on 0.x kept temperature but left the service on an unmaintained SDK line
and unable to adopt the newer models.

## Decision

We will run llm-service on `anthropic>=2.2.0,<3` (API version `2026-10-21`) and
send no `temperature`, `top_p` or `top_k` on any Anthropic call. Those calls sample
at the API default.

`LLM_TEMPERATURE` keeps applying to the LangChain providers (Google, OpenAI,
Azure OpenAI), which are unaffected.

Contract tests drive a real SDK client over a mocked transport, both directly and
through every Anthropic chain. They assert that each request carries
`anthropic-version: 2026-10-21` and no sampling parameter, so a parameter that
comes back fails in CI instead of as a production 400.

## Alternatives considered

- **Upgrade to 1.17 and pass `temperature` through `extra_body`.** This would keep
  today's output exactly, because 1.x still sends API version `2023-06-01`. It
  was rejected because it leaves the service one major version behind with the
  same decision still ahead. It also holds only as long as the model accepts
  non-default temperature, which the next model generation doesn't.
- **Stay on 0.x (`<1`).** This is the status quo PR #16 established as a stop-gap.
  It was rejected because there are no fixes on that line and newer models
  aren't reachable.
- **Strip sampling parameters centrally in `observability` before the call.**
  It was rejected because it would silently hide a regression at runtime. The
  call sites are removed instead, and tests fail loudly if one returns.

## Consequences

- Anthropic-path output varies more between runs. Haiku 4.5 now samples at the
  API default (temperature 1.0) instead of 0.4, and CV extraction and profile
  selection run at 1.0 instead of 0. Prompts and output parsing must not rely on
  deterministic sampling.
- The eval LLM judge also samples at the default, so its scores are noisier.
  Compare eval runs across several samples rather than a single run.
- Langfuse generations record only `max_tokens` as a model parameter.
- `LLM_TEMPERATURE` is ignored on the Anthropic path. It stays in Terraform and
  docker-compose for the LangChain providers.
- Moving to newer Claude models is no longer blocked by sampling settings.
- Revisit if the API reintroduces a determinism or sampling control, or if
  extraction quality measurably regresses at default sampling (the remedy then
  is prompt or structured-output work, not sampling).

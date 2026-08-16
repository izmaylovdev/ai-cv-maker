# ADR-0015: Remove the Optimize and EnhanceField AI endpoints

- **Status:** Accepted
- **Date:** 2026-06-24

## Context

The product offered two AI operations that no front-end ever exercised, or no
longer exercises:

- **`EnhanceField`** (`POST /api/ai/enhance-field`) — a single-field rewrite.
  The endpoint, gRPC RPC, and llm-service chain all existed, but **no UI ever
  called it**. Field-level editing is done through the in-editor AI chat
  (US-AI-9) instead.
- **`Optimize`** (`POST /api/job-profiles/:id/optimize`) — a whole-document
  rewrite for a target role, including a job-posting **URL fetch** path
  (US-AI-5, the `link_enricher` preprocessing module). Its only caller was a
  toolbar button on the profile page, which was removed when the in-editor AI
  chat (US-AI-9) became the single entry point for AI edits. Optimize is **not**
  reached via chat — chat uses the separate `Chat` RPC with patch ops.

Both operations were therefore dead weight spanning three services and the gRPC
contract (the designated source of truth, `proto/llm_service.proto`). Keeping
unused RPCs wired across services carries a maintenance and review cost and
misleads readers about what the product does.

## Decision

We will remove the entire vertical for both operations:

- **proto:** drop the `Optimize` and `EnhanceField` RPCs and their request/
  response messages; regenerate C# (build-time) and Python (checked-in) stubs.
- **cv-api:** delete `AiController`, the `Optimize` action, `OptimizeAsync`
  (service + interface), the `ILlmService`/`LlmService` `OptimizeAsync` and
  `EnhanceFieldAsync` methods, and the associated request/response DTOs.
- **llm-service:** delete the `Optimize`/`EnhanceField` servicer handlers, the
  `optimize_profile`/`enhance_field` chains (and their `_foundry`/`_raw`
  helpers and prompts), the `OptimizeRequest`/`OptimizeResponse` schemas, and
  the now-orphaned `link_enricher` module (US-AI-5 URL fetch — only ever used by
  optimize).
- **evals:** delete the `optimize`, `optimize_with_prefs`, and `enhance` eval
  targets, fixtures, thresholds, and stored results.
- **tests/docs:** remove the corresponding unit/e2e tests and update
  `ARCHITECTURE.md` and the AI-enhancement spec/user-stories.

## Alternatives considered

- **Remove only the REST endpoints, leave the RPCs + chains in place.** Lower
  blast radius and one wire away from re-enabling, but leaves dead code in
  llm-service and a misleading gRPC contract. Rejected in favour of a clean
  removal (explicit product decision to make chat the sole AI-edit path).
- **Keep `EnhanceField` for a future per-field "Enhance" UI.** The UI was never
  built and isn't planned; the backend is recoverable from git history if the
  feature returns. Rejected — speculative code.
- **Keep the `link_enricher` for future URL-based features.** Its sole consumer
  was optimize; chat-based URL handling, if wanted, would be specced separately.
  Rejected — orphaned module.

## Consequences

- Smaller cross-service surface: the gRPC contract now has 7 RPCs (was 9), and
  cv-api exposes no `/optimize` or `/enhance-field` routes.
- AI profile editing is now exclusively the in-editor chat (US-AI-9). Whole-
  document rewrites and job-posting-URL tailoring are **no longer available**;
  re-introducing either requires new design (likely via the chat/Chat RPC).
- Recovering any removed piece means restoring it from git history and
  regenerating stubs.
- The AI-enhancement spec (`doc/web-client/specs/ai-enhancement.md`) and its
  user stories (US-AI-1/2/3/5) are retained as historical record with REMOVED
  status notes pointing here.

> **Note (2026-08-15):** `doc/` was restructured into behaviour-oriented feature
> docs; the spec and user-story files named above no longer exist. The removal is
> recorded in [`doc/web-client/ai-usage.md`](../web-client/ai-usage.md); the
> original files are in git history.

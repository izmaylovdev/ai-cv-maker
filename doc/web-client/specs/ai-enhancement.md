# Spec: AI Enhancement & Optimization

**Source user stories:** US-AI-1 – US-AI-5, US-AI-9  
**Feature area:** AI-powered profile optimization and conversational editing  
**Status:** Partially removed (see banner) — chat editing (US-AI-9) is the only live AI-edit path

---

> **REMOVED (ADR-0015, 2026-06-24).** The **Optimize** (`POST /api/job-profiles/:id/optimize`)
> and **EnhanceField** (`POST /api/ai/enhance-field`) endpoints, their gRPC RPCs,
> llm-service chains, and the job-posting-URL fetch path (US-AI-5,
> `link_enricher`) have been **deleted**. AI profile editing is now exclusively
> the in-editor chat (US-AI-9, [`chat.md`](./chat.md)). Sections §2.1, §2.2, §2.3,
> §3, and §7 below describe functionality that **no longer exists** and are kept
> only as historical record. See [ADR-0015](../../adr/0015-remove-optimize-enhance-endpoints.md).

> **Contract note (ADR-0013 / ADR-0014).** Parts of this spec were written before
> the canonical document model and the conversational-edit redesign. Where a
> snippet shows the retired `ProfileInput` message, structured profile fields
> (`title`/`summary`/`workExperience`/`skills`), or REST paths under
> `/api/profiles/:id`, treat it as **historical narrative** — the boxed
> "As shipped" notes in each section describe current behaviour. The canonical
> model is `ProfileDocument { header, sections[] }` (proto `ProfileDocumentProto`,
> flat title-anchored tree per ADR-0014); `Generate`/`Optimize`/`ExtractProfile`
> take and return documents. The authoritative chat contract lives in
> [`chat.md`](./chat.md). See also `ARCHITECTURE.md` (gRPC contract + REST routes).

## 1. Overview

AI assistance on the profile page is delivered through the **in-editor AI chat** (US-AI-9, the `<ai-chat-widget>` embedded next to `<applysy-profile-builder>`). The user describes what they want in natural language; the AI proposes a structured edit to the open document, which is applied live to the builder for review and persisted only on Save. This covers both targeted tweaks and whole-document rewrites — there is no separate "Optimize" or per-field "Enhance" UI.

> **History.** The original draft (below) imagined two dedicated UI affordances — a per-field "Enhance ✨" button (US-AI-1) and a modal-driven "Optimize for role" review flow (US-AI-2/3). Neither shipped as drawn, and both backends have now been **removed** (ADR-0015):
> - **US-AI-1 field enhancement:** never had a UI; the `enhance-field` endpoint and `EnhanceField` RPC are deleted.
> - **US-AI-2 optimize:** shipped briefly as a prompt → full-document rewrite (no ReviewModal); the toolbar button, the `optimize` endpoint, and the `Optimize` RPC are deleted.
>
> All AI edits remain **non-destructive** — factual data (company names, job titles, dates) is preserved, and nothing is saved until the user explicitly clicks Save.

---

## 2. Functional Requirements

### 2.1 Enhance a Single Field (US-AI-1) — *REMOVED (ADR-0015)*

> **Removed.** No UI ever exposed this, and the backend (`POST /api/ai/enhance-field`,
> `EnhanceField` gRPC RPC, llm-service `enhance_field` chain) has been **deleted**
> (ADR-0015). The requirements below are historical only.

| # | Requirement (intended UI — not implemented) |
|---|-------------|
| F-AI-1.1 | An "Enhance" button (✨ icon or label) is visible on all multi-line text inputs (work experience description, professional summary, etc.). |
| F-AI-1.2 | Clicking "Enhance" calls the AI with the current field value; the field enters a loading state while waiting. |
| F-AI-1.3 | On success the AI-rewritten text replaces the field content. |
| F-AI-1.4 | The factual content of the field (dates, company names, technologies, numbers) is preserved verbatim. |
| F-AI-1.5 | The user can undo the enhancement by editing or clearing the field manually (standard form edit). |
| F-AI-1.6 | If the request fails, an error toast is shown and the original text is restored unchanged. |

### 2.2 Optimize Full Profile (US-AI-2) — *REMOVED (ADR-0015)*

> **Removed.** The optimize backend (`POST /api/job-profiles/:id/optimize`,
> `Optimize` gRPC RPC, llm-service `optimize_profile` chain) has been **deleted**
> (ADR-0015), along with the toolbar button that drove it. Dedicated whole-
> document rewrites are no longer offered; targeted edits go through the in-editor
> AI chat (US-AI-9, see [`chat.md`](./chat.md)). The requirements below are
> historical only — they describe a modal/review UI that was never built as drawn.

| # | Requirement (original draft — superseded by chat, US-AI-9) |
|---|-------------|
| F-AI-2.1 | ~~An "Optimize for role" action is available on the profile editor page (e.g., in the toolbar).~~ |
| F-AI-2.2 | ~~Clicking it opens a modal where the user enters a free-text description of their target role.~~ |
| F-AI-2.3 | The AI rewrites the relevant document sections (title, summary, experience descriptions, skills ordering). |
| F-AI-2.4 | Factual data (company names, job titles, dates, degree names) must not be changed by the AI. |
| F-AI-2.5 | ~~After the AI responds, the user enters a review step to see each suggestion before applying.~~ Review happens in the builder itself after the edit is applied. |
| F-AI-2.6 | The user can accept (Save) or discard (reload / undo) the changes. |
| F-AI-2.7 | Discarding before Save leaves the persisted profile untouched (no data loss). |

### 2.3 Review Suggestions (US-AI-3) — *not implemented*

> **As shipped.** There is no side-by-side / diff review modal. Both chat edits
> and the (former) optimize flow apply changes directly into the live builder
> document, where the user reviews them inline and Saves or discards via the
> editor's own undo / reload. The requirements below were never built.

| # | Requirement (not implemented) |
|---|-------------|
| F-AI-3.1 | The review step presents each suggested change alongside the original text (side-by-side or sequential). |
| F-AI-3.2 | The user can clearly distinguish original from suggested content (e.g., diff highlighting or labelled columns). |
| F-AI-3.3 | Discarding any change reverts that field exactly to its pre-optimization value. |

---

## 3. Technical Specification

### 3.1 API Endpoints

#### `POST /api/ai/enhance-field`

Enhances a single text field. Not profile-scoped (the field content is sent directly). Currently no UI calls this; documented for completeness.

**Request body:** (`EnhanceFieldRequest`)
```json
{
  "content": "Worked on frontend features for the main product.",
  "fieldPurpose": "work experience description"
}
```

**Response 200:** (`EnhanceFieldResponse`)
```json
{ "enhanced": "Developed and shipped responsive frontend features for the core SaaS product, improving user engagement by 20%." }
```

**Response 400:** `content` or `fieldPurpose` missing.  
**Response 502 / 503:** Upstream AI error or temporarily unavailable.

---

#### `POST /api/job-profiles/:id/optimize`

Rewrites the entire profile document for a free-text goal / role (or a job-posting URL, see §7). Returns the full rewritten document; the client loads it into the builder for review and Save (no auto-save).

**Request body:** (`OptimizeProfileRequest`)
```json
{ "message": "Senior React developer at a fintech startup" }
```

**Response 200:** (`OptimizeProfileResponse`) — the canonical `ProfileDocument`:
```json
{ "document": { "header": { "...": "..." }, "sections": [ "..." ] } }
```

**Response 400:** `message` is empty.  
**Response 422:** job-posting URL fetch failed (`{ "error": "..." }`, see §7).  
**Response 502 / 503:** Upstream AI error or temporarily unavailable.

---

### 3.2 AI Prompt Design

#### Field Enhancement Prompt

```
You are a professional CV writer. Rewrite the following CV field to sound more impactful and professional.

Rules:
- Preserve all factual information (dates, company names, technologies, metrics).
- Use active voice and achievement-oriented language.
- Return only the rewritten text, no preamble.

Field content:
{{value}}
```

#### Profile Optimization Prompt

> **Schema note (ADR-0013/0014).** The optimize chain operates on the canonical
> `ProfileDocument` (`{ header, sections[] }`, flat title-anchored tree) and
> returns a document — **not** the retired `{ title, summary, workExperience,
> skills }` structure shown below. The prompt text lives in
> `apps/llm-service/app/chains/cv_chain.py`; this snippet is illustrative history.

```
You are an expert CV coach. Rewrite the following profile sections to be compelling for the target role described below.

Target role: {{targetRole}}

Profile data (JSON):
{{profileJson}}

Rules:
- skills must be sorted with most relevant to the target role first.
- Do NOT change company names, job titles, dates, degree names, or any other factual data.
- Do NOT invent achievements or metrics not present in the original.
```

### 3.3 Client-Side Optimization Flow (as shipped)

There is no `ReviewModal`. The optimize request returns a full `ProfileDocument`,
which the client loads directly into the live `<applysy-profile-builder>`:

```
User requests a rewrite (via the AI chat, US-AI-9)
  → Loading state in the chat thread
  → On success: rewritten document applied to the builder (unsaved)
  → User reviews inline and clicks Save  → PUT /api/job-profiles/:id
                            or undo/reload → discards, persisted profile untouched
```

### 3.4 Concurrency & Loading States (as shipped)

| State | UI |
|-------|----|
| AI request in progress (chat / optimize / extract) | Inline busy indicator on the triggering control; the action is disabled until it resolves |

> The original per-field "Enhance button spinner" / "full-screen optimize overlay"
> states do not apply — those UIs were not built.

### 3.5 Error Handling

| Error | HTTP Status (actual) | Client Behaviour |
|-------|------------|-----------------|
| AI service unavailable / upstream failure | 502 | Error toast / chat note |
| AI temporarily unavailable (circuit open) | 503 | Error toast: _"AI is temporarily unavailable. Please try again."_ |
| Provider rate limit / quota exceeded | 503 | Error toast: _"AI is temporarily unavailable. Please try again later."_ |
| Per-user cost limit reached | 402 | Usage-limit message (see §9) |
| Empty / invalid input (`message`, `content`) | 400 | Inline validation |
| Job-posting URL fetch failed | 422 | Error from `{ error }` body (see §7) |

> Note: the provider rate-limit case surfaces as **503**, not 429 — there is no
> dedicated per-minute request throttle (see §3.6).

### 3.6 Rate Limiting

> **As shipped.** There is **no** per-minute / per-hour request throttle. AI usage
> is governed by the per-user **cost-based usage limit** (§8–§9): each call is
> checked against the user's accrued estimated LLM cost and rejected once the limit
> is reached. The fixed-window numbers below were never implemented.

- ~~Field enhancement: max 10 requests per profile per minute per user.~~
- ~~Profile optimization: max 3 requests per profile per hour per user.~~

---

## 4. Data Model

AI suggestions are ephemeral (not persisted). The server acts as a pass-through to the AI provider; only the final saved document is persisted via `PUT /api/job-profiles/:id`.

No additional database tables are required for this feature. (Per-user LLM cost accounting for the usage limit is covered in §8.)

---

## 5. Out of Scope (MVP)

- Per-field "Enhance" UI in the builder (removed entirely — see §2.1, ADR-0015)
- Side-by-side / diff review of AI suggestions (see §2.3)
- Suggestion history / undo stack beyond the editor's own undo
- Custom AI prompts or tone settings (global preferences are covered in `settings.md`)

---

## 6. Conversational Profile Chat — Web Component (US-AI-4)

> **Superseded — see [`chat.md`](./chat.md) (US-AI-9) for the authoritative,
> as-shipped contract.** This section captures the original US-AI-4 design. The
> shipped widget diverges in its integration contract:
> - **Output event:** the widget emits an `edit` `CustomEvent` with detail
>   `{ patchJson, description }` (bubbling, composed) — **not** `profile-change`
>   with a `{ patch: ProfilePatch }` proposal card. The host applies it via
>   `builder.applyEdit(patchJson)`; invalid edits are surfaced back through the
>   widget's `addAssistantNote(text)` method.
> - **No Accept/Reject proposal card:** the edit is applied live to the builder
>   (unsaved) and reviewed inline; nothing persists until the user Saves.
> - **gRPC:** `Chat` carries the canonical `ProfileDocumentProto` (not the retired
>   `ProfileInput`); the per-profile chat receives the full open document.
>
> The element name (`<ai-chat-widget>`) and its `profile-id` / `auth-token` /
> `api-base` attributes below are still accurate.

### 6.1 Functional Requirements (original US-AI-4 design)

| # | Requirement |
|---|-------------|
| F-AI-6.1 | A "Chat" button/link is present on the profile page, opening the chat panel. |
| F-AI-6.2 | The chat widget is delivered as an Angular Element (`<ai-chat-widget>`) loaded at runtime from a separately-deployed `chat-ui` container. |
| F-AI-6.3 | The widget displays a scrollable chat history (user messages and AI replies, most recent at bottom). |
| F-AI-6.4 | The user can type a message and submit it (Enter key or Send button). |
| F-AI-6.5 | The AI can answer read-only questions about the profile (e.g., "What skills do I have?"). |
| F-AI-6.6 | The AI can propose profile edits in response to natural-language instructions. |
| F-AI-6.7 | Proposed edits are shown as a structured proposal card with Accept and Reject buttons. |
| F-AI-6.8 | Accepting a proposal dispatches a `profile-change` custom DOM event; the main app applies and saves the change. |
| F-AI-6.9 | Rejecting a proposal dismisses the card; the profile is unchanged. |
| F-AI-6.10 | A typing indicator is shown while waiting for the AI response. |
| F-AI-6.11 | If the API call fails, an error message appears in the chat; no `profile-change` event is emitted. |
| F-AI-6.12 | Chat history is session-scoped (not persisted across page reloads, MVP). |

### 6.2 Technical Specification

#### New Nx app: `apps/chat-ui`

A standalone **React + Vite** application. The entry point registers a single custom element and exits — it does not mount a root component into `index.html`:

```tsx
// apps/chat-ui/src/main.tsx
import ReactDOM from 'react-dom/client';
import { ChatApp } from './ChatApp';

class ChatWidget extends HTMLElement {
  private root?: ReturnType<typeof ReactDOM.createRoot>;

  connectedCallback() {
    this.root = ReactDOM.createRoot(this);
    this.render();
  }

  disconnectedCallback() {
    this.root?.unmount();
  }

  static get observedAttributes() {
    return ['profile-id', 'auth-token', 'api-base'];
  }

  attributeChangedCallback() {
    this.render();
  }

  private render() {
    this.root?.render(
      <ChatApp
        profileId={this.getAttribute('profile-id') ?? ''}
        authToken={this.getAttribute('auth-token') ?? ''}
        apiBase={this.getAttribute('api-base') ?? '/api'}
        onProfileChange={(patch) =>
          this.dispatchEvent(new CustomEvent('profile-change', { detail: { patch }, bubbles: true }))
        }
      />
    );
  }
}

customElements.define('ai-chat-widget', ChatWidget);
```

Build output is a single `chat-widget.js` bundle (Vite `lib` mode) served by an nginx container.

#### `chat-ui` container

- Mirrors the `ui-angular` Dockerfile pattern: Node build stage → nginx serve.
- Nx build target: `npx nx build chat-ui` (Vite under the hood via `@nx/vite`).
- Served on port 80 inside the container (exposed as `4201` locally).
- Added to `docker-compose.yml` as service `chat-ui`.
- The main app's nginx config is extended to proxy `/chat-widget/` → `http://chat-ui:80/`.

#### Web component inputs / outputs

| Input attribute | Type | Description |
|---|---|---|
| `profile-id` | `string` | The profile the chat operates on. |
| `api-base` | `string` | Base URL for API calls (e.g., `/api`). Defaults to `/api`. |
| `auth-token` | `string` | JWT passed by the main app so the widget can call the API. |

| Output event | Payload | Description |
|---|---|---|
| `profile-change` | `{ patch: ProfilePatch }` | Emitted when user accepts a proposal. Main app applies the patch. |

#### Main app integration (`apps/ui-angular`)

1. `environment.ts` adds `chatWidgetUrl: '/chat-widget/chat-widget.js'`.
2. A new `ChatLoaderService` lazily injects the `<script>` tag once and resolves when `customElements.whenDefined('ai-chat-widget')` resolves.
3. The profile page adds a "Chat" panel (toggle button shows/hides it):

```html
<ai-chat-widget
  [attr.profile-id]="profileId"
  [attr.auth-token]="authToken"
  api-base="/api"
  (profile-change)="onProfileChange($event)">
</ai-chat-widget>
```

#### API

**`POST /api/job-profiles/:id/chat`**

Request body:
```json
{
  "message": "Add TypeScript to my skills",
  "history": [
    { "role": "user",      "content": "What skills do I have?" },
    { "role": "assistant", "content": "You have: React, Node.js, CSS." }
  ]
}
```

Response 200:
```json
{
  "reply": "Here's the proposed change:",
  "proposal": {
    "type": "add_skill",
    "description": "Add skill: TypeScript",
    "patch": { "skills": [{ "name": "TypeScript" }] }
  }
}
```

`proposal` is `null` for read-only answers.

Error responses:
- `403`: profile does not belong to the authenticated user.
- `404`: profile not found.
- `502`: upstream AI error.

#### gRPC (llm-service)

New RPC added to `proto/llm_service.proto`:

```proto
rpc Chat (ChatRequest) returns (ChatResponse);

message ChatMessage {
  string role    = 1;
  string content = 2;
}

message ChatRequest {
  ProfileInput          profile = 1;
  string                message = 2;
  repeated ChatMessage  history = 3;
}

message ChatProposal {
  string type        = 1;
  string description = 2;
  string patch_json  = 3;
}

message ChatResponse {
  string       reply    = 1;
  ChatProposal proposal = 2;
}
```

Regenerate stubs with:
```bash
npm run grpc:generate
```

#### Data model

No new DB tables. Chat history lives in the widget's component state. Accepted patches are applied by the main app via the existing `PUT /api/job-profiles/:id` endpoint.

### 6.3 Out of Scope (MVP)

- Persistent chat history across sessions or devices
- Streaming responses (SSE / WebSocket)
- Module Federation or shared runtime between Angular and React apps
- Per-field accept/reject (one proposal per turn, accept-all or reject-all)

---

## 7. Job-Posting URL Optimization (US-AI-5) — *REMOVED (ADR-0015)*

> **Removed.** This was a server-side capability of the `Optimize` flow: the
> `link_enricher` module detected a URL in the optimize `message`, fetched the
> page, and extracted a job description before rewriting. With `Optimize` deleted
> (§2.2, ADR-0015), `link_enricher` is gone too. The requirements below are
> historical only.

### 7.1 Functional Requirements

| # | Requirement |
|---|-------------|
| F-AI-7.1 | The user may supply a plain-text role description **or** a job posting URL as the optimize `message` (originally the "Optimize with AI" dialog field; now the AI chat). |
| F-AI-7.2 | The llm-service detects whether the `message` field of `OptimizeRequest` contains a URL (scheme `http://` or `https://`). |
| F-AI-7.3 | When a URL is detected, the llm-service fetches the page and extracts a plain-text job description before running the optimize chain. |
| F-AI-7.4 | The extracted job description is used as the optimization target in place of the raw URL string. |
| F-AI-7.5 | If the fetch fails (network error, non-2xx status, timeout) or the extracted text is empty, the llm-service raises an error; optimization does **not** proceed. |
| F-AI-7.6 | The cv-api translates the fetch error into HTTP 422 with a human-readable message. |
| F-AI-7.7 | The client displays the error message returned by the API so the user can correct the URL or switch to plain text. |
| F-AI-7.8 | No changes to the proto/gRPC interface or data model. |

### 7.2 Technical Specification

#### Scope

This feature is a **pure llm-service internal change**. No modifications are required to:

- `proto/llm_service.proto` — `OptimizeRequest.message` already carries the free-text target.
- `cv-api` — `POST /api/job-profiles/:id/optimize` is unchanged, except for mapping the new gRPC error (see below).
- `apps/ui-angular` — the optimize caller already surfaces the API error message to the user (originally the "Optimize with AI" dialog; now the AI chat thread).

#### Architecture: link pre-processing pipeline

URL enrichment is implemented as a **standalone pre-processing step** that runs before any LLM call. It is not LLM tool use — detection is deterministic (regex), making it fast, testable, and reusable by other chains (e.g. the Chat chain for link previews).

```
incoming message
      │
      ▼
┌─────────────────────┐
│  LinkEnricher       │  regex detects URLs → fetches → strips HTML → truncates
└─────────────────────┘
      │ EnrichedMessage (text + optional LinkPreview metadata)
      ▼
┌─────────────────────┐
│  optimize_profile() │  builds prompt from enriched text, ignores raw URL
└─────────────────────┘
      │
      ▼
   LLM call
```

#### New module: `apps/llm-service/app/preprocessing/link_enricher.py`

```python
@dataclass
class LinkPreview:
    url: str
    title: str        # page <title> or og:title
    description: str  # og:description or first 200 chars of body text

@dataclass
class EnrichedMessage:
    text: str                        # full text with URL replaced by extracted content
    link_preview: LinkPreview | None # populated when a URL was found and fetched

async def enrich(message: str) -> EnrichedMessage:
    """
    Detects the first URL in `message` with a regex, fetches the page,
    extracts plain text, and returns an EnrichedMessage.
    Raises LinkFetchError on fetch failure or empty content.
    """
```

Implementation steps:

1. **Detect** — `re.search(r'https?://\S+', message)`. If no match, return `EnrichedMessage(text=message, link_preview=None)` immediately.
2. **Fetch** — `httpx.AsyncClient` with a 10-second timeout; follow redirects; read up to 500 KB.
3. **Parse** — BeautifulSoup extracts `<title>` / `og:title`, `og:description`, and strips all tags from `<body>` to get plain text.
4. **Truncate** — keep at most 8 000 characters of body text to avoid prompt bloat.
5. **Build** — return `EnrichedMessage` with the extracted text and a `LinkPreview` (for future use by chat).
6. **Error** — any fetch/parse failure raises `LinkFetchError` with a user-readable message.

#### Integration in `cv_chain.py`

```python
async def optimize_profile(profile: ProfileInput, message: str) -> OptimizeResponse:
    enriched = await enrich(message)          # pre-processing step
    inputs = _build_optimize_inputs(profile, enriched.text)
    ...
```

Both the `foundry` and LangChain code paths use `enriched.text`, so no provider-specific changes are needed.

#### Future reuse in chat chain

`chat_chain.py` can call `enrich(user_message)` before the LLM turn and pass `enriched.link_preview` back to the client as a structured card — without any further changes to this module.

#### Dependencies

Add to `apps/llm-service/pyproject.toml`:

```
httpx = ">=0.27"
beautifulsoup4 = ">=4.12"
```

#### Error handling

| Failure | llm-service | cv-api | Angular dialog |
|---------|-------------|--------|----------------|
| Network / DNS error | Raise `LinkFetchError("Could not reach the URL")` | HTTP 422 `{ "error": "Could not reach the job posting URL. Please check the link or paste the job description manually." }` | Error shown inline in the dialog |
| HTTP non-2xx | Raise `LinkFetchError("URL returned {status}")` | Same 422 pattern | Same |
| Timeout (>10 s) | Raise `LinkFetchError("Timed out fetching URL")` | Same 422 pattern | Same |
| Empty text after stripping | Raise `LinkFetchError("No readable content found at URL")` | Same 422 pattern | Same |

`LinkFetchError` propagates as a gRPC `INVALID_ARGUMENT` status. cv-api catches that status code and maps it to HTTP 422. The Angular optimize caller (now the AI chat, US-AI-9) surfaces non-2xx responses and displays the `error` field from the response body.

### 7.3 Out of Scope (MVP)

- Parsing structured job-posting schemas (JSON-LD, microdata)
- Caching fetched pages
- Handling multiple URLs in a single message (only the first URL is processed)
- Link preview display in the optimize UI (preview metadata is produced but not rendered)
- Sanitising or validating URLs before fetching (internal/private URLs not blocked)

---

## 8. LLM Token Usage Tracking (US-AI-6)

### 8.1 Functional Requirements

| # | Requirement |
|---|-------------|
| F-AI-8.1 | Every gRPC response from llm-service includes prompt_tokens, completion_tokens, and model_name fields. |
| F-AI-8.2 | cv-api persists one `LlmUsage` row per LLM call, containing UserId, Operation, PromptTokens, CompletionTokens, ModelName, and CreatedAt. |
| F-AI-8.3 | Cost is calculated on-the-fly using a price table in `appsettings.json` keyed by model name (`PromptCostPer1M` and `CompletionCostPer1M` in USD). Unknown models fall back to a configurable default entry. |
| F-AI-8.4 | Admin API exposes `GET /api/admin/usage` returning per-user aggregates (total prompt tokens, completion tokens, estimated cost USD). |
| F-AI-8.5 | cv-api exposes `GET /api/usage` (authenticated) returning the calling user's aggregate token counts and estimated cost. |
| F-AI-8.6 | Angular `/settings/usage` page displays the current user's usage summary. |

### 8.2 Technical Specification

#### gRPC proto change

Add a `UsageMetadata` message to `proto/llm_service.proto` and embed it in every response:

```proto
message UsageMetadata {
  int32 prompt_tokens     = 1;
  int32 completion_tokens = 2;
  string model_name       = 3;
}
```

All response messages (`GenerateResponse`, `OptimizeResponse`, `ExtractProfileResponse`, `EnhanceFieldResponse`, `ChatResponse`, `UserChatResponse`, `CoverLetterResponse`) gain a field:

```proto
UsageMetadata usage = <next_field_number>;
```

Regenerate stubs after proto changes:
```bash
npm run grpc:generate
```

#### Data model

New table `LlmUsages`:

| Column | Type | Notes |
|--------|------|-------|
| Id | Guid PK | |
| UserId | Guid FK → Users | nullable (system calls) |
| Operation | string | e.g. "Generate", "Chat" |
| PromptTokens | int | |
| CompletionTokens | int | |
| ModelName | string | |
| CreatedAt | DateTime | UTC |

#### Price table (`appsettings.json`)

```json
"LlmPricing": {
  "Models": {
    "claude-sonnet-4-6": { "PromptCostPer1M": 3.0, "CompletionCostPer1M": 15.0 },
    "default":           { "PromptCostPer1M": 3.0, "CompletionCostPer1M": 15.0 }
  }
}
```

#### API

`GET /api/usage` — authenticated, returns:
```json
{ "promptTokens": 12000, "completionTokens": 3000, "estimatedCostUsd": 0.081 }
```

`GET /api/admin/usage` — admin-authenticated, returns:
```json
[{ "userId": "…", "email": "…", "promptTokens": 12000, "completionTokens": 3000, "estimatedCostUsd": 0.081 }]
```

#### Angular

New standalone component `UsageComponent` at `features/settings/usage/`. Route: `/settings/usage`. Linked from the settings page.

### 8.3 Out of Scope (MVP)

- Per-operation breakdown in the user-facing view
- ~~Usage quotas / hard limits~~ — implemented in §9 (US-AI-7)
- Real-time streaming token counts
- Usage for non-LLM operations

## 9. Per-User LLM Spending Limit (US-AI-7)

Builds directly on §8: reuses the `LlmUsage` ledger and the `UsageService`
cost calculation. Adds a hard cap that blocks AI requests once a user's
accrued estimated cost reaches a configurable limit, editable from the admin
panel.

### 9.1 Functional Requirements

| # | Requirement |
|---|-------------|
| F-AI-9.1 | Before any LLM call (Generate, GenerateAuto, Optimize, Extract, Chat, UserChat, EnhanceField, CoverLetter), cv-api compares the user's accrued estimated cost (from §8 calculation) against the effective limit and rejects the request if accrued cost ≥ limit. |
| F-AI-9.2 | The check runs *before* the gRPC call, so a blocked request makes no LLM call and records no new `LlmUsage` row. |
| F-AI-9.3 | A request from a user still under the limit is allowed even if it would push the total over; the cap is evaluated on cost accrued so far (the pending call's cost is unknown in advance). |
| F-AI-9.4 | A blocked request returns HTTP 402 with a stable machine-readable code `usage_limit_exceeded` and a human-readable message; no profile/CV data is mutated. |
| F-AI-9.5 | The effective limit is read from the `LlmUsageLimitUsd` app-setting in the DB; when absent it falls back to `UsageLimit:MaxCostUsdPerUser` in `appsettings.json` (default `0.50`). |
| F-AI-9.6 | Admin can read and update the limit: cv-api exposes `GET`/`PUT /api/admin/usage-limit` (API-key auth, ADR-0005); admin-api proxies them; admin-ui provides a control to view and change the value. |
| F-AI-9.7 | A non-positive or non-numeric limit is rejected (`PUT` returns 400); the limit applies globally to all users. |
| F-AI-9.8 | When the Angular app receives a 402 `usage_limit_exceeded` from any AI action, it shows a distinct "spending limit reached" message rather than the generic AI-failure message. |
| F-AI-9.9 | The `/settings/usage` page displays the user's effective spending limit and remaining budget (limit − accrued cost, floored at 0) alongside their accrued cost. |

### 9.2 Technical Specification

#### Data model

New key-value table `AppSettings` (generic, single string value per key):

| Column | Type | Notes |
|--------|------|-------|
| Key | string PK | e.g. `LlmUsageLimitUsd` |
| Value | string | serialized value (e.g. `"0.50"`) |
| UpdatedAt | DateTime | UTC |

EF Core migration `AddAppSettings`. No seed row — absence means "use the
`appsettings.json` default", so a fresh DB needs no migration data.

#### Config (`appsettings.json`)

```json
"UsageLimit": { "MaxCostUsdPerUser": 0.50 }
```

#### Enforcement (cv-api)

- New `UsageLimitExceededException` (carries the effective limit).
- `UsageService.GetEffectiveLimitAsync()` — reads `AppSettings[LlmUsageLimitUsd]`, falls back to `UsageLimitOptions.MaxCostUsdPerUser`.
- `UsageService.EnsureWithinLimitAsync(Guid? userId)` — computes accrued cost (existing `Summarize`) and throws `UsageLimitExceededException` when `accrued >= limit`. A `null` userId (system calls) is exempt.
- Call `EnsureWithinLimitAsync` at the start of each of the 8 LLM operations (the same call sites that already call `RecordAsync`).
- Global exception handling (`IExceptionHandler` registered in `Program.cs`) maps `UsageLimitExceededException` → 402 with body:

```json
{ "code": "usage_limit_exceeded", "message": "You've reached your AI usage limit of $0.50.", "limitUsd": 0.50 }
```

#### Admin API (cv-api, behind `AdminApiKeyFilter`)

`GET /api/admin/usage-limit` →
```json
{ "maxCostUsd": 0.50 }
```

`PUT /api/admin/usage-limit` body `{ "maxCostUsd": 0.50 }` → 200 with the saved value; 400 if `maxCostUsd` ≤ 0 or missing. Persists to `AppSettings`.

#### admin-api (NestJS proxy)

New `UsageLimitModule` (controller + service) mirroring `UsersService`: forwards
`GET`/`PUT /usage-limit` to cv-api `…/api/admin/usage-limit` with the
`X-Admin-Api-Key` header. JWT-guarded like the users route.

#### admin-ui (Next.js)

New `/settings` page (linked from the main nav) with a numeric USD input showing
the current limit and a Save button that `PUT`s the new value. Shows success/error feedback.

#### Angular

`api.interceptor.ts` (or a small shared error helper) maps a 402 with
`code === 'usage_limit_exceeded'` to a distinct user-facing message reused by the
AI entry points (AI chat, CV generation, and any other LLM-backed action).

`GET /api/usage` is extended to include the effective limit:

```json
{ "promptTokens": 12000, "completionTokens": 3000, "estimatedCostUsd": 0.081, "limitUsd": 0.50 }
```

(`UsageController` composes `limitUsd` from `UsageService.GetEffectiveLimitAsync()`;
the shared `Summarize`/admin DTOs are unchanged.) The `/settings/usage` page
shows the limit and the remaining budget (`limitUsd − estimatedCostUsd`, floored
at 0) next to the accrued cost.

### 9.3 Out of Scope (MVP)

- Per-user individual limit overrides (limit is global)
- Time-windowed / resetting quotas (e.g. monthly) — this is a lifetime cumulative cap
- Soft warnings as the user approaches the cap
- Admin audit log of limit changes

---

## 10. Collapsible Slide-in AI Chat Sidebar (US-AI-10)

Purely a presentation change to the in-editor chat from §6 / US-AI-9: the chat
moves from a always-visible static side column to a togglable panel that slides
in from the right edge of the screen and can be hidden back. The chat web
component, its conversation thread, and its live document binding are unchanged
— only its host layout on the profile page changes.

### 10.1 Functional Requirements

| # | Requirement |
|---|-------------|
| F-AI-10.1 | The profile editor renders a toggle button ("AI Editor") that opens and closes the chat sidebar; the button reflects the current open/closed state (`aria-expanded`, pressed styling). |
| F-AI-10.2 | Opening animates the panel sliding in from the right edge; closing slides it back out until fully hidden (`translateX(100%)` + width/visibility), with a CSS transition. |
| F-AI-10.3 | On large screens (`lg+`) the open panel **pushes** the document column: the builder column shrinks to the left to make room; there is no overlay or scrim. On small screens the panel slides over the (near-)full viewport width. |
| F-AI-10.4 | The chat web component stays mounted across open/close cycles — closing only hides the panel (CSS), it does not destroy the element, reset the thread, or drop the live document binding. |
| F-AI-10.5 | A close (✕) control in the panel header, the toggle button, and the Escape key all close the panel. |
| F-AI-10.6 | The open/closed state is persisted to `localStorage` and restored on load; default is closed when no stored value exists. |
| F-AI-10.7 | Works in light and dark themes; the chat's editing behavior (US-AI-9, `edit` event handling, live document sync) is unchanged. |

### 10.2 Technical Specification

#### Angular (`apps/ui-angular/src/app/features/profile/`)

`ProfileComponent`:
- New `chatOpen` signal, initialized from `localStorage` (key `applysy.profile.chatOpen`, default `false`).
- `toggleChat()` flips `chatOpen` and writes it back to `localStorage`; an `effect` (or the setter) keeps storage in sync.
- A host `@HostListener('document:keydown.escape')` (or `(keydown.escape)` on the panel) closes the panel when open.
- The existing `chatRef` `viewChild` and the `currentDocument` → `chat.document` seeding `effect` are preserved; the `<ai-chat-widget>` element must remain in the DOM while merely hidden, so the panel is toggled with CSS classes rather than `@if`. (`@if (chatReady())` still gates initial mount once the widget script has loaded.)

`profile.component.html`:
- Add a toggle button to the header actions row (and the mobile actions row) bound to `chatOpen()` / `toggleChat()`.
- Replace the static `<aside>` flex column with a fixed-position panel that
  tucks **below the full-width page header** rather than over it:
  - Panel: `fixed right-0 bottom-0 w-full sm:w-96`, anchored under the header —
    `top-14` on mobile (below the app's top bar) and `md:top-[var(--chat-top)]`
    where `--chat-top` is the measured `#pageHeader` height. It slides via
    `transform: translateX(...)`.
  - Closed: `translate-x-full` + `invisible` + `pointer-events-none`; Open:
    `translate-x-0`. `transition-[transform,visibility] duration-300` so the
    slide-out stays visible until it settles.
  - Header inside the panel keeps the "AI Editor" title + helper text and adds the ✕ close button.
  - The page header stays full width (`#pageHeader`); a small `effect` tracks its
    height via `ResizeObserver` and exposes it as the `headerHeight` signal.
- Push behavior on `lg+`: the document column gets a right margin when
  `chatOpen()` so it visually shrinks rather than being overlaid
  (`lg:mr-96` on the editor column). No scrim element.

No API, data-model, gRPC, or backend changes.

### 10.3 Out of Scope (MVP)

- Resizable / draggable panel width.
- Sliding the chat in from the left, or a bottom-sheet variant.
- Remembering panel state per-profile (state is a single global preference).
- Animating the editor column reflow beyond the panel's own slide transition.

## 11. Specific Chat Error Messages (US-AI-11)

When an in-editor chat request fails, the chat widget must show a specific,
plain-language reason for the failure instead of the current generic
`"Something went wrong. Please try again."`. The cause is classified server-side
into a stable machine-readable `code` plus a user-facing `message`, and the
widget renders that `message` verbatim in an error bubble.

This mirrors the existing pattern for the spending limit (§9 / `UsageLimitExceptionHandler`,
HTTP 402 `usage_limit_exceeded`), which already returns `{ code, message }` but
whose `message` the chat widget currently discards.

### 11.1 Functional Requirements

| # | Requirement |
|---|-------------|
| F-AI-11.1 | `POST /api/chat` returns failures as a structured JSON body `{ code, message }` with an appropriate HTTP status; `message` is always a clean, user-facing sentence — never a raw exception/`RpcException` string or stack text. |
| F-AI-11.2 | The cv-api `ChatController` no longer wraps LLM calls in a catch-all that returns `502 "Chat failed: {ex.Message}"`; LLM/domain exceptions propagate to dedicated `IExceptionHandler`s that produce the structured body. |
| F-AI-11.3 | gRPC `StatusCode.Internal` from llm-service (e.g. a truncated/unparseable edit response) is classified as `code = "llm_edit_failed"` → HTTP 502, message: the assistant couldn't produce a valid edit (response may have been too long); try a smaller or more specific edit. |
| F-AI-11.4 | gRPC `StatusCode.InvalidArgument` (guard / scope / validation rejection) is classified as `code = "llm_invalid_request"` → HTTP 422, message: the assistant's own explanation (the gRPC status detail), e.g. message-too-long or out-of-scope. |
| F-AI-11.5 | `LlmRateLimitException` (gRPC `ResourceExhausted`) → `code = "llm_rate_limited"` → HTTP 429; `LlmUnavailableException` (gRPC `Unavailable`/`DeadlineExceeded`) → `code = "llm_unavailable"` → HTTP 503. Each with its existing user-facing message. |
| F-AI-11.6 | The usage-limit failure keeps its current contract: `code = "usage_limit_exceeded"` → HTTP 402; the chat widget now renders its `message` like any other classified error. |
| F-AI-11.7 | The chat widget reads the error response body and renders `message` in an `error`-role bubble, visually distinct from assistant replies. If the body is missing/unparseable, it falls back to a single generic sentence. |
| F-AI-11.8 | A failed request leaves the open document unchanged (no partial edit applied) and the conversation remains usable — the user can send another message. |

### 11.2 Technical Specification

#### API

`POST /api/chat` — success contract unchanged (`{ reply, proposal? }`).

Error response (all failure statuses), body:
```json
{ "code": "llm_edit_failed", "message": "I couldn't produce a valid edit for that — my response may have been too long. Try a smaller or more specific change." }
```

Status ↔ code map:

| HTTP | `code` | Cause |
|---|---|---|
| 402 | `usage_limit_exceeded` | Per-user spending limit reached (existing). |
| 422 | `llm_invalid_request` | gRPC `InvalidArgument` — message too long / out of scope / guard rejection. `message` = gRPC status detail. |
| 429 | `llm_rate_limited` | gRPC `ResourceExhausted` — provider quota. |
| 502 | `llm_edit_failed` | gRPC `Internal` — edit response truncated/unparseable. |
| 503 | `llm_unavailable` | gRPC `Unavailable` / `DeadlineExceeded` — service unreachable/timeout. |

#### cv-api

- `Infrastructure/ExternalServices/Llm/LlmService.cs` — extend `ExecuteAsync` to translate two more statuses: `StatusCode.Internal` → new `LlmEditFailedException`; `StatusCode.InvalidArgument` → new `LlmInvalidRequestException` (carries the gRPC status detail as its message).
- Two new exception types alongside `LlmRateLimitException` / `LlmUnavailableException`.
- `Features/Chat/ChatController.cs` — remove the `try/catch (Exception) → StatusCode(502, ...)` in both `Chat` and `EditAsync`; let exceptions surface.
- New `IExceptionHandler`s (mirroring `UsageLimitExceptionHandler`) for `LlmInvalidRequestException` (422), `LlmRateLimitException` (429), `LlmEditFailedException` (502), `LlmUnavailableException` (503), each writing `{ code, message }`. Registered in `Program.cs` via `AddExceptionHandler<...>()` before `AddProblemDetails()`/`UseExceptionHandler()`.

#### chat-ui (`apps/chat-ui/src/ChatApp.tsx`)

- On `!res.ok`, parse the JSON body; push an `error`-role message with `body.message`. Only fall back to a generic sentence when the body is absent or unparseable.
- No new message roles or styling needed — the `error` role and its bubble styling already exist.

#### gRPC

No proto changes. llm-service already aborts with `INVALID_ARGUMENT` (guards) and `INTERNAL` (parse failure); this feature classifies the statuses it already emits.

#### Out of scope (MVP)

- Hardening llm-service so oversized edits don't fail in the first place (raise the chat `max_tokens`, make `_parse_response` tolerant of truncation / detect `stop_reason == "max_tokens"`). Tracked separately — this story is about surfacing the failure clearly, not preventing it.
- Automatic retry/backoff on `llm_unavailable`.
- Per-code styling/iconography beyond the existing error-bubble treatment.

## 12. In-Editor Chat Opens in Conversation View (US-AI-12)

Purely a presentation change to the chat web component (§6 / US-AI-9). Today the
`ChatApp` has two layouts: a centered **landing** splash ("How can I help you?"
with the input floating mid-panel) shown while `messages` is empty, and the
normal **conversation** layout (scrolling thread on top, input pinned to the
bottom) once a message exists. For the **in-editor** chat — the instance bound to
the open profile document — the empty state should use the conversation layout
directly, so opening the panel and sending the first message no longer swap
layouts. The global read-only `/chat` assistant keeps the landing splash.

The in-editor instance is already distinguished by the presence of the
`document` prop (it is the only caller that passes a document; the global chat
omits it — see `ChatApp.test.tsx` "does not send a document on the global chat").
That same prop gates this layout choice — no new prop is introduced.

### 12.1 Functional Requirements

| # | Requirement |
|---|-------------|
| F-AI-12.1 | When `ChatApp` is rendered **with** a `document` and has no messages yet, it renders the conversation layout (scrollable thread area on top, `MessageInput` anchored at the bottom) — not the centered landing splash. |
| F-AI-12.2 | The empty thread area shows a brief, unobtrusive greeting/hint (e.g. "Ask me to edit your CV — add a role, rewrite a summary, turn a list into chips.") styled as muted helper text, not as an assistant message bubble. |
| F-AI-12.3 | Sending the first message does not move the input: it stays pinned at the bottom before and after, with the greeting replaced by the growing thread. |
| F-AI-12.4 | When `ChatApp` is rendered **without** a `document` (global assistant) and has no messages, the existing centered landing splash is unchanged. |
| F-AI-12.5 | Works in light and dark themes; US-AI-9 editing behavior, error handling (US-AI-11), and history/scroll behavior are unchanged. |

### 12.2 Technical Specification

#### chat-ui (`apps/chat-ui/src/ChatApp.tsx`, `ChatApp.css`)

- Replace the `isEmpty` branch with a layout decision that also considers the
  `document` prop. The landing splash renders only for the **global** empty case
  (`messages.length === 0 && !document`). In every other case — any in-editor
  state, and any chat with messages — render the conversation layout
  (`.chat-messages` + bottom `MessageInput`).
- In the conversation layout, when `messages.length === 0`, render a muted
  greeting element inside `.chat-messages` (reuse/extend the existing
  `.chat-empty` class, which already has light/dark muted styling) instead of an
  empty list. It is plain helper text, not a `.chat-message` bubble, so it is not
  part of `messages` and is not sent as history.
- The `loading` typing indicator, `bottomRef` auto-scroll, and `MessageInput`
  (non-`landing` variant) are reused as-is.

No API, data-model, gRPC, or backend changes. No new props.

### 12.3 Out of Scope (MVP)

- Changing the global `/chat` assistant's landing splash, or making the greeting
  configurable/role-aware.
- Suggested-prompt chips or any interactive empty-state affordances beyond the
  static hint.
- Animating the transition from greeting to first message.

---

## 13. In-Editor AI Editor Cross-Profile Reads (US-AI-13)

### 13.1 Functional Requirements

| # | Requirement |
|---|-------------|
| F-AI-13.1 | The `Chat` (in-editor edit) agent can enumerate the user's *other* saved profiles and read any one's full content on demand, without the user opening or pasting them. |
| F-AI-13.2 | The agent invokes cross-profile reads only when the request needs them; requests satisfiable from the open document alone produce no tool calls (US-AI-9 behavior unchanged). |
| F-AI-13.3 | cv-api supplies only the authenticated user's own profiles to the agent; no other user's data is ever passed to `llm-service`. |
| F-AI-13.4 | Reads never mutate another profile; any `edit` proposal still targets only the open document and is not auto-saved. |
| F-AI-13.5 | A `get_profile` for an unknown/unreadable id returns a tool error the agent reports in its reply, leaving the document unchanged. |
| F-AI-13.6 | When the agent uses another profile as a source, its reply names that profile. |
| F-AI-13.7 | Cross-profile content is subject to the same guardrails as US-AI-9 (no invented facts, CV/career scope only, embedded-instruction injection ignored). |
| F-AI-13.8 | The profile open in the editor is excluded from the cross-profile list — it never appears in `list_profiles`, so the agent cannot offer the open profile as a source for populating itself. |
| F-AI-13.9 | A conversational reply (e.g. a clarifying question the agent asks after a tool call, "which profile should I use as the source?") is shown to the user verbatim, with no proposal and the document unchanged — it is **not** mis-reported as an "unexpected format" failure. |

### 13.2 Technical Specification

**Design.** The AI Editor edit agent runs as the `Chat` gRPC RPC → `chat_reply`
chain. Because `llm-service` has no database access, cv-api pre-fetches the
authenticated user's saved profiles and passes them down in the `ChatRequest`.
The agent uses Anthropic tool-use to look them up on demand — only compact
summaries reach the model's context until it calls a tool, giving the
"only when needed" / token-efficient behavior. Tools are resolved in-process
from the passed-in set (no DB call, no cross-user leakage).

#### gRPC (`proto/llm_service.proto`)

Add an `OtherProfile` message and a repeated field on `ChatRequest`:

```proto
message OtherProfile {
  string               id       = 1;
  string               name     = 2;
  ProfileDocumentProto document = 3;
}

message ChatRequest {
  ProfileDocumentProto profile        = 1;
  string               message        = 2;
  repeated ChatMessage history        = 3;
  repeated OtherProfile other_profiles = 4;  // US-AI-13: user's other saved profiles, for on-demand tool reads
}
```

Regenerate stubs: `npm run grpc:generate`.

#### LLM service (`apps/llm-service/app/chains/chat_chain.py`)

- `chat_reply(...)` gains an `other_profiles: list[OtherProfile]` param (id, name, document).
- Anthropic/Foundry path becomes a bounded tool-use loop (max ~4 iterations)
  exposing two tools:
  - `list_profiles` → `[{id, name, title, overview}]` derived from `other_profiles`
    (title/overview from each document's header + first paragraph).
  - `get_profile{profile_id}` → the matching profile's full `ProfileDocument` JSON,
    or an error result if no id matches.
- The system prompt gains a short section: other profiles exist; use the tools
  only when the request references them; edits apply solely to the open document;
  name the source profile when borrowing content.
- Response parsing (`_parse_response`) treats a reply with **no JSON envelope** as a
  legitimate conversational turn (F-AI-13.9): after a tool call the model often
  answers in plain prose (e.g. a clarifying question), which is returned to the user
  verbatim with no proposal. Only a reply that *starts* an envelope (`{`) but can't
  be decoded is a genuine failure (the distinct "unexpected format" / truncation
  handling still applies).
- Generic langchain fallback (non-Anthropic providers): no tool loop — inject a
  compact `list_profiles`-style summary block inline when `other_profiles` is
  non-empty (degraded mode).
- Tool inputs/results and iteration count are traced via `observability` like
  existing calls.

#### cv-api (`apps/cv-api/`)

- `Infrastructure/ExternalServices/Llm/LlmDtos.cs`: add
  `record LlmOtherProfile(string Id, string Name, ProfileDocument Document)` and
  add `List<LlmOtherProfile> OtherProfiles` to `LlmChatRequest`.
- `Infrastructure/ExternalServices/Llm/LlmService.cs`: map `OtherProfiles` into
  the new proto field.
- `Features/Chat/ChatController.EditAsync`: load the user's saved profiles
  (`db.Profiles.Where(p => p.UserId == UserId)`) **excluding the open profile**
  identified by the request's `ProfileId` (`p.Id != openId`), and pass the rest as
  `OtherProfiles` (F-AI-13.8). When `ProfileId` is absent (older clients / an
  unsaved doc) the full owned set is passed. No new endpoint — same `POST /api/chat`,
  same response shape to the frontend.

#### Angular / frontend

The in-editor chat sends the open profile's id so the server can exclude it: the
`<ai-chat-widget>` gains a `profileId` property (mirroring `document`); the profile
page sets it from the route, and `ChatApp` includes `profileId` in the edit-mode
request body. The global (read-only) and side-panel chats are unaffected.

#### Data model

No schema change, no migration (reads existing `Profiles`).

### 13.3 Out of Scope (MVP)

- Tool-use (agentic) loop for non-Anthropic providers — those get an
  inline-summary degraded mode only.
- Cross-profile *writes* / editing another profile.
- Fuzzy lookup by profile name (tools key on id).

---

## 14. Per-User Billing Balance (US-AI-14)

Turns the single **global** spending cap of §9 (US-AI-7) into a **per-user
monetary balance**. Each user has their own dollar *allowance*; their AI spend
(the §8 cost calculation, unchanged) is deducted from it; the remaining
*balance* is shown on a new Billing page, and AI is blocked once a user's own
balance reaches zero. There is **no top-up / payment** — the allowance is
seeded from config and (optionally, later) adjusted out of band.

**Relationship to §8/§9.** §8 token tracking and cost estimation are reused
verbatim (`LlmUsage`, `UsageService.Summarize`). §9's enforcement mechanism
(`EnsureWithinLimitAsync`, the 402 `usage_limit_exceeded` contract, the
`UsageLimitExceededException` → HTTP mapping, and the frontend `usage-limit.ts`
helper) is reused too — the only change is that the threshold it compares
against is now the requesting user's **own allowance** rather than one global
value. The global admin limit (§9.6) becomes the **default allowance** applied
to users without an explicit account. The existing `/usage` page and
`GET /api/usage` are left unchanged.

### 14.1 Functional Requirements

| # | Requirement |
|---|-------------|
| F-AI-14.1 | Each user has a per-user billing account carrying a monetary allowance in USD. When a user has no account row yet, their effective allowance is the configurable default `Billing:DefaultAllowanceUsd` (which itself falls back to the §9 effective global limit for backward compatibility). |
| F-AI-14.2 | cv-api exposes `GET /api/billing` (JWT-authenticated) returning the calling user's `allowanceUsd`, `spentUsd`, `balanceUsd`, `currency`, `promptTokens`, and `completionTokens`. |
| F-AI-14.3 | `spentUsd` is the §8 estimated cost over the user's own `LlmUsage` rows. `balanceUsd` = `max(0, allowanceUsd − spentUsd)` — never negative in the response. `currency` is `"USD"`. |
| F-AI-14.4 | Before any LLM call, cv-api compares the user's `spentUsd` against **that user's own** effective allowance and rejects the request when `spentUsd ≥ allowanceUsd`. The comparison is per-user: one user's spend never affects another user's allowance, balance, or block state. |
| F-AI-14.5 | A blocked request behaves exactly as §9: the check runs *before* the gRPC call (no LLM call, no new `LlmUsage` row), returns HTTP 402 with the stable code `usage_limit_exceeded` and a human-readable **billing-balance** message, and mutates no profile/CV data. |
| F-AI-14.6 | A user whose `spentUsd` is still below their allowance is allowed to proceed even if that single call would push them over (threshold evaluated on spend accrued so far; the pending call's cost is unknown in advance). |
| F-AI-14.7 | The Angular `/billing` route renders a Billing page (auth-guarded) showing the balance, allowance, and amount spent in dollars, the prompt/completion token totals behind the spend, and a spent-vs-allowance progress bar; it renders correctly in light and dark themes. |
| F-AI-14.8 | A "Billing" item appears in the authenticated navigation sidebar and links to `/billing`. |
| F-AI-14.9 | When the Angular app receives a 402 `usage_limit_exceeded` from any AI action, it surfaces the distinct billing-balance message (reusing the existing `usage-limit.ts` helper), not the generic AI-failure message. |

### 14.2 Technical Specification

#### Data model

New table `BillingAccounts` (one row per user, created on demand):

| Column | Type | Notes |
|--------|------|-------|
| Id | Guid PK | |
| UserId | Guid FK → Users | unique (one account per user) |
| AllowanceUsd | decimal(18,6) | the user's monetary allowance |
| Currency | string | `"USD"` (fixed for MVP) |
| UpdatedAt | DateTime | UTC |

EF Core migration `AddBillingAccounts` (per CLAUDE.md — generate with
`dotnet ef migrations add AddBillingAccounts` in `apps/cv-api`). No seed rows:
absence of a row means "use the config default allowance", so a fresh DB needs
no migration data.

#### Config (`appsettings.json`)

```json
"Billing": { "DefaultAllowanceUsd": 0.50 }
```

`BillingOptions.DefaultAllowanceUsd` is **nullable** (`decimal?`, default `null`).
When it is `null` (key absent), the effective default allowance falls back to
`UsageService.GetEffectiveLimitAsync()` — this is what preserves §9 behavior and
keeps the existing `UsageLimitTests` passing unchanged (a user with no
`BillingAccount` row and no `Billing` config is still capped at exactly the
global limit). `appsettings.Development.json` may set a comfortable dev value
(e.g. `2.00`, mirroring the existing dev `UsageLimit`).

#### Enforcement & service (cv-api, `apps/cv-api/Features/Usage/`)

Extend the existing `UsageService` (keeps enforcement in one place):

- `GetEffectiveAllowanceAsync(Guid userId)` — returns the user's
  `BillingAccount.AllowanceUsd` if a row exists, else `BillingOptions.DefaultAllowanceUsd`
  when non-null, else `GetEffectiveLimitAsync()` (§9 global limit fallback).
- Constructor gains an `IOptions<BillingOptions>` parameter. The existing
  `UsageLimitTests` `Service(...)` helper must be updated to pass
  `Options.Create(new BillingOptions())` (i.e. `DefaultAllowanceUsd = null`),
  which routes through the fallback so **every existing assertion in
  `UsageLimitTests` still passes unchanged** — that is the §9 no-regression proof.
- `EnsureWithinLimitAsync(Guid? userId)` — **changed**: computes the user's
  accrued cost (existing `Summarize`) and their effective *allowance* (above),
  throws `UsageLimitExceededException(allowance)` when `accrued ≥ allowance`.
  `null` userId (system calls) stays exempt. All 8 existing call sites are
  unchanged.
- `GetBillingSummaryAsync(Guid userId)` — composes `BillingSummaryDto` from the
  user's `Summarize` result and their effective allowance.
- `UsageLimitExceededException` message is reworded to billing-balance language,
  e.g. *"Your billing balance is exhausted — you've used your $0.50 AI allowance."*
  The HTTP mapping (`UsageLimitExceptionHandler` → 402, body
  `{ code: "usage_limit_exceeded", message, limitUsd }`) is unchanged so
  `usage-limit.ts` and §11 keep working; `limitUsd` now carries the allowance.

New `BillingController` (`apps/cv-api/Features/Billing/`), `[Authorize]`,
`[Route("api/billing")]`:

```
GET /api/billing  →  { "allowanceUsd": 0.50, "spentUsd": 0.081, "balanceUsd": 0.419,
                       "currency": "USD", "promptTokens": 12000, "completionTokens": 3000 }
```

`record BillingSummaryDto(decimal AllowanceUsd, decimal SpentUsd, decimal BalanceUsd, string Currency, int PromptTokens, int CompletionTokens)`.

#### Angular (`apps/ui-angular/src/app/`)

- `features/billing/billing.service.ts` — `getMyBilling()` → `GET /api/billing`,
  `BillingSummary` interface.
- `features/billing/billing.component.ts` — standalone `BillingComponent`:
  balance / allowance / spent cards in USD, token totals, a spent-vs-allowance
  progress bar (turns red at ≥ 100%), light/dark styling (mirrors the existing
  `UsageComponent` visual language).
- `app.routes.ts` — new lazy route `{ path: 'billing', canActivate: [authGuard],
  loadComponent: … BillingComponent }`.
- `app.html` — add a "Billing" sidebar link (e.g. `credit_card` material icon)
  in the authenticated `<nav>`, after the "Usage" link.
- No change to `usage-limit.ts` logic — only the server message copy changes.

#### Out of Scope (MVP)

- Adding funds / top-up / any payment provider (Stripe etc.).
- A user- or admin-facing UI to edit a user's allowance (rows are created with
  the config default; explicit per-user allowances are set out of band for now).
- Currencies other than USD.
- Resetting / periodic (monthly) allowances — this is a lifetime cumulative
  allowance, like §9.
- Consolidating or removing the existing `/usage` page — both pages coexist
  (`/usage` = token focus, `/billing` = money focus).
- Soft warnings as the balance approaches zero.

---

## 15. Resizable AI Chat Sidebar (US-AI-15)

Adds a drag-to-resize handle to the slide-in AI chat sidebar from §10 /
US-AI-10, which the §10.3 out-of-scope list explicitly deferred. The panel's
width becomes a user-adjustable, persisted value instead of the fixed `w-96`
(384px); everything else about the panel (slide animation, push-not-overlay
on `lg+`, mount/hide behavior, document binding) is unchanged.

### 15.1 Functional Requirements

| # | Requirement |
|---|-------------|
| F-AI-15.1 | On `lg+` screens, the open chat panel shows a drag handle on its left (inner) edge; `cursor: ew-resize` on hover. |
| F-AI-15.2 | Dragging the handle resizes the panel live: moving the pointer left increases width, moving it right decreases width. |
| F-AI-15.3 | The width is clamped to `[320px, min(720px, 66% of viewport width)]`; the clamp is re-evaluated on window resize so the panel never exceeds the viewport. |
| F-AI-15.4 | While resized on `lg+`, the document column's right margin equals the panel's current width exactly (no gap, no overlap) — extending the push behavior of F-AI-10.3 from a fixed to a dynamic width. |
| F-AI-15.5 | The width is persisted to `localStorage` and restored on load; default (no stored value, or below `sm`/`md` where the handle doesn't apply) is 384px, matching the current fixed width. |
| F-AI-15.6 | Dragging or adjusting the width does not remount the chat element, reset the conversation thread, or drop the live document binding (F-AI-10.4 unchanged). |
| F-AI-15.7 | Below `lg`, no handle is rendered and width behaves exactly as in US-AI-10 (`w-full` under `sm`, fixed `384px` at `sm`/`md`). |
| F-AI-15.8 | The handle is a focusable control with an accessible name (`role="separator"`, `aria-orientation="vertical"`, `aria-label="Resize AI Editor panel"`, `aria-valuenow`/`aria-valuemin`/`aria-valuemax` reflecting the current/clamped width in px); `ArrowLeft`/`ArrowRight` while focused adjust the width by a fixed step within the same clamp. |
| F-AI-15.9 | Works in light and dark themes. |

### 15.2 Technical Specification

#### Angular (`apps/ui-angular/src/app/features/profile/`)

`ProfileComponent`:
- New `chatWidth` signal (px, number), initialized from `localStorage` (key
  `applysy.profile.chatWidth`), clamped against the current viewport at read
  time; default `384`.
- `MIN_CHAT_WIDTH = 320`; `computeMaxWidth()` = `Math.min(720, ceil(innerWidth * 0.66))`.
- `clampWidth(px)` clamps to `[MIN_CHAT_WIDTH, computeMaxWidth()]`.
- `setChatWidth(px)` clamps, updates the signal, and writes to `localStorage`
  (mirrors the existing `setChatOpen` pattern).
- `isLgViewport()` / `maxChatWidth()` template helpers gate the handle and
  push behavior to `lg+` and surface the clamp bound to `aria-valuemax`.
- Drag handling: `onHandlePointerDown(event)` captures the pointer and records
  `startX`/`startWidth`; `document` `pointermove` listeners (added on down,
  removed on `pointerup`/`pointercancel`) call
  `setChatWidth(startWidth + (startX - clientX))` per move.
- Keyboard: `onHandleKeydown(event)` on `ArrowLeft`/`ArrowRight` calls
  `setChatWidth(chatWidth() ± 16)`.
- `@HostListener('window:resize')` re-clamps `chatWidth()` against the new max.

`profile.component.html`:
- `<aside>` width bound with `[style.width.px]="chatOpen() && isLgViewport() ? chatWidth() : null"`
  (falls back to `sm:w-96` / `w-full` below `lg`).
- Editor column right margin bound with
  `[style.marginRight.px]="chatReady() && chatOpen() && isLgViewport() ? chatWidth() : 0"`.
- A handle element inside the `<aside>` (`hidden lg:block absolute left-0 ...
  cursor-ew-resize`) with the separator ARIA attributes and the pointer/keyboard
  handlers.

No API, data-model, gRPC, or backend changes.

### 15.3 Out of Scope (MVP)

- Per-profile width memory (persisted as a single global preference, same as
  `chatOpen`).
- Resizing on `sm`/`md` screens or the full-width `<sm` overlay.
- Snapping/presets (e.g. double-click to reset to default width).
- Touch-drag beyond what Pointer Events already covers natively.

---

## 16. Group a Chat Conversation as a Langfuse Session (US-AI-16)

### 16.1 Functional Requirements

| # | Requirement |
|---|-------------|
| F-AI-16.1 | All LLM traces produced by messages sent within one chat-widget mount share a single Langfuse `session_id` and appear grouped under one Session in Langfuse's Sessions view. |
| F-AI-16.2 | A page reload (fresh widget mount) yields a new `session_id`; its messages form a distinct Session and are not mixed with the previous one. |
| F-AI-16.3 | Per-user attribution is unchanged — a Session's traces still carry the authenticated `user_id` (existing ADR-0010 behavior). |
| F-AI-16.4 | The session id rides as gRPC call metadata (`x-session-id`), alongside the existing `x-trace-id` / `x-user-id`; the proto message contract is unchanged. |
| F-AI-16.5 | When Langfuse is not configured, chat behaves exactly as before — the session id is accepted and forwarded but nothing observability-related runs (no-op), and no user-facing behavior changes. |
| F-AI-16.6 | A missing/empty session id is a no-op: traces are produced without a session (never an error), so older/other clients that don't send one keep working. |

### 16.2 Technical Specification

**Design.** Langfuse groups traces into a Session when each trace's root sets
`session_id` (ADR-0010). The chat conversation has no server-side identity, so the
**client** mints the id: the `chat-ui` widget generates one `crypto.randomUUID()`
per mount and sends it on every `POST /api/chat`. cv-api forwards it to
`llm-service` as gRPC metadata `x-session-id` (the same channel as `x-trace-id` /
`x-user-id` — no proto change). `llm-service` reads it in the trace interceptor and
sets it on the root trace. Each message remains its own trace (seeded from the
per-request `x-trace-id`); `session_id` is the only thing tying them together, so
the Sessions view stitches the conversation while individual traces are unaffected.

#### API

`POST /api/chat` — request body gains one optional field:

```json
{
  "message": "…",
  "history": [ … ],
  "document": { … },      // optional (edit mode) — unchanged
  "jobContext": { … },    // optional (job chat)  — unchanged
  "sessionId": "b1f2…-uuid"  // NEW, optional: conversation id (one per widget mount)
}
```

Response 200: unchanged (`{ reply, proposal? }`). Omitting `sessionId` is valid
(F-AI-16.6). No auth or route change.

#### chat-ui (`apps/chat-ui/src/ChatApp.tsx`)

- Mint a stable id once per component mount — `const sessionId = useRef(crypto.randomUUID()).current;` (or `useState(() => crypto.randomUUID())`). It is created at mount and reset only when the component remounts (page reload), which matches "one conversation = one widget mount" (US-AI-16).
- Include `sessionId` in every `POST ${apiBase}/chat` body, in all three context branches (plain assistant, `document` edit mode, `jobContext`). It is independent of the mutually-exclusive context fields.

#### cv-api (`apps/cv-api/`)

- `Features/Chat/ChatController.cs`: add `string? SessionId = null` to the
  `UserChatRequest` DTO record. Thread it into the domain requests built in
  `Chat` (→ `LlmUserChatRequest`), `EditAsync` (→ `LlmChatRequest`), and
  `JobChatAsync` (→ `LlmJobChatRequest`).
- `Infrastructure/ExternalServices/Llm/LlmDtos.cs`: add `string? SessionId = null`
  to `LlmUserChatRequest`, `LlmChatRequest`, and `LlmJobChatRequest`.
- `Infrastructure/ExternalServices/Llm/LlmService.cs`: replace the parameterless
  `DefaultCallOptions` property with a `BuildCallOptions(string? sessionId)` helper
  (keep the existing `x-trace-id` / `x-user-id` logic) that adds an
  `x-session-id` metadata header when `sessionId` is non-empty. `ChatAsync`,
  `UserChatAsync`, and `JobChatAsync` pass `request.SessionId`; the other RPCs
  (Generate/Extract/CoverLetter/SelectBestProfile) call `BuildCallOptions(null)`.

#### llm-service (`apps/llm-service/app/observability.py`)

- Add `SESSION_ID_HEADER = "x-session-id"`.
- `parse_trace_metadata(...)` returns a new `"session_id"` key (value or `None`).
- `rpc_span(...)`: pass `session_id=<parsed value>` into
  `c.update_current_trace(...)` (Langfuse Python SDK v3 accepts `session_id`).
  When absent it is `None` → no session bound (F-AI-16.6). The `trace_interceptor`
  already forwards all invocation metadata into `rpc_span`, so no interceptor
  change is needed.

#### Data model

No schema change, no migration. No gRPC proto change (session id is call metadata).

### 16.3 Out of Scope (MVP)

- Persisting the session id across page reloads (localStorage) or a "new chat"
  reset button — a reload deliberately starts a new Session (US-AI-16).
- A server-minted / DB-backed conversation entity — the id is client-generated and
  used only for observability grouping.
- Propagating a session id from the Chrome-extension job-chat UI — the cv-api/
  llm-service plumbing accepts one generically, but only the `chat-ui` widget is
  wired to send it in this story.
- Grouping non-chat LLM calls (Generate/Extract/CoverLetter) into Sessions.

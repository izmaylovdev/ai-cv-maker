# Spec: AI Enhancement & Optimization

**Source user stories:** US-AI-1 – US-AI-3  
**Feature area:** AI-powered field enhancement and full profile optimization  
**Status:** Draft

---

## 1. Overview

AI assistance is available at two levels:

- **Field-level enhancement (US-AI-1):** Improve a single text field in place. The user clicks "Enhance", the AI rewrites that field, and the result replaces the original. The original can be restored by typing or clearing.
- **Profile-level optimization (US-AI-2):** Rewrite the entire profile for a specific target role. The user describes their target, the AI returns a full set of suggestions, and the user reviews and accepts or discards them field by field.

Both features are **non-destructive** — factual data (company names, job titles, dates) is never altered, and the user always has the final say.

---

## 2. Functional Requirements

### 2.1 Enhance a Single Field (US-AI-1)

| # | Requirement |
|---|-------------|
| F-AI-1.1 | An "Enhance" button (✨ icon or label) is visible on all multi-line text inputs (work experience description, professional summary, etc.). |
| F-AI-1.2 | Clicking "Enhance" calls the AI with the current field value; the field enters a loading state while waiting. |
| F-AI-1.3 | On success the AI-rewritten text replaces the field content. |
| F-AI-1.4 | The factual content of the field (dates, company names, technologies, numbers) is preserved verbatim. |
| F-AI-1.5 | The user can undo the enhancement by editing or clearing the field manually (standard form edit). |
| F-AI-1.6 | If the request fails, an error toast is shown and the original text is restored unchanged. |

### 2.2 Optimize Full Profile (US-AI-2)

| # | Requirement |
|---|-------------|
| F-AI-2.1 | An "Optimize for role" action is available on the profile editor page (e.g., in the toolbar). |
| F-AI-2.2 | Clicking it opens a modal where the user enters a free-text description of their target role (e.g., _"Senior React developer at a fintech startup"_). |
| F-AI-2.3 | The AI returns suggestions for: professional title, summary/overview, all work experience descriptions, and a prioritized skills list. |
| F-AI-2.4 | Factual data (company names, job titles, dates, degree names) must not be changed by the AI. |
| F-AI-2.5 | After the AI responds, the user enters a review step to see each suggestion before applying. |
| F-AI-2.6 | The user can accept or discard the entire set of changes. |
| F-AI-2.7 | Discarding reverts all fields to their pre-optimization state with no data loss. |

### 2.3 Review Suggestions (US-AI-3)

| # | Requirement |
|---|-------------|
| F-AI-3.1 | The review step presents each suggested change alongside the original text (side-by-side or sequential). |
| F-AI-3.2 | The user can clearly distinguish original from suggested content (e.g., diff highlighting or labelled columns). |
| F-AI-3.3 | Discarding any change reverts that field exactly to its pre-optimization value. |

---

## 3. Technical Specification

### 3.1 API Endpoints

#### `POST /api/profiles/:id/enhance-field`

Enhances a single text field.

**Request body:**
```json
{
  "field": "workExperience[0].description",
  "value": "Worked on frontend features for the main product."
}
```

**Response 200:**
```json
{ "enhanced": "Developed and shipped responsive frontend features for the core SaaS product, improving user engagement by 20%." }
```

**Response 422:** Field path not recognised.  
**Response 502:** Upstream AI error — client should display error toast and preserve original value.

---

#### `POST /api/profiles/:id/optimize`

Optimizes the entire profile for a target role.

**Request body:**
```json
{ "targetRole": "Senior React developer at a fintech startup" }
```

**Response 200:**
```json
{
  "suggestions": {
    "title": "Senior Frontend Engineer",
    "summary": "...",
    "workExperience": [
      { "id": "entry-uuid", "description": "..." }
    ],
    "skills": ["React", "TypeScript", "Redux", "Node.js", "..."]
  }
}
```

**Response 422:** `targetRole` is empty.  
**Response 502:** Upstream AI error.

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

```
You are an expert CV coach. Rewrite the following profile sections to be compelling for the target role described below.

Target role: {{targetRole}}

Profile data (JSON):
{{profileJson}}

Rules:
- Return a JSON object matching the schema: { title, summary, workExperience: [{id, description}], skills: [string] }
- skills must be sorted with most relevant to the target role first.
- Do NOT change company names, job titles, dates, degree names, or any other factual data.
- Do NOT invent achievements or metrics not present in the original.
```

Server must validate the AI response JSON against the expected schema before returning it to the client.

### 3.3 Client-Side Optimization Review Flow

```
User clicks "Optimize for role"
  → Modal: enter target role → Submit
  → Loading state (spinner, "Optimizing your profile…")
  → On success: navigate to ReviewModal component
    → Show original vs. suggested for each changed field
    → [Accept changes] → merge suggestions into form state → mark form dirty
    → [Discard]        → close modal, form state unchanged
```

The `ReviewModal` does **not** trigger an API call on accept — it only updates local form state. The user must explicitly save the profile afterwards.

### 3.4 Concurrency & Loading States

| State | UI |
|-------|----|
| Field enhancement in progress | Field input is disabled; spinner icon replaces the Enhance button |
| Profile optimization in progress | Full-screen overlay or modal loading state |
| Another enhancement already running | Enhance buttons on other fields are disabled until first completes |

### 3.5 Error Handling

| Error | HTTP Status | Client Behaviour |
|-------|------------|-----------------|
| AI service unavailable | 502 | Toast: _"AI is temporarily unavailable. Please try again."_ |
| AI returned invalid JSON | 502 | Same as above; server logs the raw response |
| Rate limit exceeded | 429 | Toast: _"Too many requests. Please wait a moment."_ |
| Target role field empty | 422 | Inline validation error in the optimize modal |

### 3.6 Rate Limiting

- Field enhancement: max **10 requests per profile per minute** per user.
- Profile optimization: max **3 requests per profile per hour** per user.
- Limits enforced server-side; client receives HTTP 429 and displays the appropriate message.

---

## 4. Data Model

AI suggestions are ephemeral (not persisted). The server acts as a pass-through to the AI provider; only the final accepted profile state is saved via `PUT /api/profiles/:id`.

No additional database tables are required for this feature.

---

## 5. Out of Scope (MVP)

- Per-field accept/discard in the optimization review (MVP accepts or discards all at once)
- Suggestion history / undo stack beyond the current session
- Custom AI prompts or tone settings
- AI-generated cover letters

---

## 6. Conversational Profile Chat — Web Component (US-AI-4)

### 6.1 Functional Requirements

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

## 7. Job-Posting URL Optimization (US-AI-5)

### 7.1 Functional Requirements

| # | Requirement |
|---|-------------|
| F-AI-7.1 | The user may type a plain-text role description **or** paste a job posting URL into the existing target-role field in the "Optimize with AI" dialog. |
| F-AI-7.2 | The llm-service detects whether the `message` field of `OptimizeRequest` contains a URL (scheme `http://` or `https://`). |
| F-AI-7.3 | When a URL is detected, the llm-service fetches the page and extracts a plain-text job description before running the optimize chain. |
| F-AI-7.4 | The extracted job description is used as the optimization target in place of the raw URL string. |
| F-AI-7.5 | If the fetch fails (network error, non-2xx status, timeout) or the extracted text is empty, the llm-service raises an error; optimization does **not** proceed. |
| F-AI-7.6 | The cv-api translates the fetch error into HTTP 422 with a human-readable message. |
| F-AI-7.7 | The Angular dialog displays the error message returned by the API so the user can correct the URL or switch to plain text. |
| F-AI-7.8 | No changes to the proto/gRPC interface, Angular component structure, or data model. |

### 7.2 Technical Specification

#### Scope

This feature is a **pure llm-service internal change**. No modifications are required to:

- `proto/llm_service.proto` — `OptimizeRequest.message` already carries the free-text target.
- `cv-api` — `POST /api/job-profiles/:id/optimize` is unchanged, except for mapping the new gRPC error (see below).
- `apps/ui-angular` — the "Optimize with AI" dialog already handles error responses.

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

`LinkFetchError` propagates as a gRPC `INVALID_ARGUMENT` status. cv-api catches that status code and maps it to HTTP 422. The Angular optimize dialog already handles non-2xx responses and displays the `error` field from the response body.

### 7.3 Out of Scope (MVP)

- Parsing structured job-posting schemas (JSON-LD, microdata)
- Caching fetched pages
- Handling multiple URLs in a single message (only the first URL is processed)
- Link preview display in the optimize dialog (preview metadata is produced but only used by future chat feature)
- Sanitising or validating URLs before fetching (internal/private URLs not blocked)

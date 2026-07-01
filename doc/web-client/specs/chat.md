# Spec: AI Career Assistant Chat

**Source user stories:** US-AI-4  
**Feature area:** Conversational AI assistant  
**Status:** Draft

---

## 1. Overview

A dedicated Chat page in `ui-angular` embeds `<ai-chat-widget>` — a self-contained React application packaged as an IIFE Custom Element. The widget sends messages to `POST /api/chat`, which loads the authenticated user's profile summaries as read-only context so the assistant can answer profile-specific questions.

The global `/chat` assistant is Q&A only. Editing a profile via chat is handled by a second instance of the same widget embedded in the profile editor — see §6 (US-AI-9).

---

## 2. Functional Requirements

| # | Requirement |
|---|-------------|
| F-CHAT-1.1 | A "Chat" entry is accessible from the main navigation. |
| F-CHAT-1.2 | The chat page shows an "AI Career Assistant" heading and subtitle. |
| F-CHAT-1.3 | The user can send free-text messages to the AI assistant. |
| F-CHAT-1.4 | The AI has read access to the user's profile summaries (name, title, overview, skills list) as context for every message. |
| F-CHAT-1.5 | The assistant can answer questions about the user's profile and career (e.g. "What skills do I have listed?", "How does my summary read?"). |
| F-CHAT-1.6 | Full conversation history for the current session is forwarded with each request so the assistant maintains conversational context. |
| F-CHAT-1.7 | A typing indicator (animated dots) is shown while waiting for a response. |
| F-CHAT-1.8 | The message list auto-scrolls to the latest message after each update. |
| F-CHAT-1.9 | Pressing Enter submits the message; Shift+Enter inserts a newline. |
| F-CHAT-1.10 | The Send button is disabled while a response is in flight or the input is empty. |
| F-CHAT-1.11 | If the request fails, an inline error message is shown in the conversation thread and the input is re-enabled. |
| F-CHAT-1.12 | An empty-state prompt is displayed when no messages have been sent. |
| F-CHAT-1.13 | The widget respects the active theme (light/dark) via the `.dark` class on `<html>`. |

---

## 3. Technical Specification

### 3.1 API Endpoint

#### `POST /api/chat`

Requires: `Authorization: Bearer <token>`

**Request body:**
```json
{
  "message": "What skills do I have listed?",
  "history": [
    { "role": "user",      "content": "…" },
    { "role": "assistant", "content": "…" }
  ]
}
```

`history` contains only `user` and `assistant` turns; `error` role messages from the widget are filtered before sending.

**Response 200:**
```json
{ "reply": "You currently have the following skills listed: …" }
```

**Response 400:** `"Message is required."` — empty or whitespace-only message.

**Failure responses (US-AI-11, see `specs/ai-enhancement.md` §11):** classified into a
`{ code, message }` body so the widget can show a specific reason. `402 usage_limit_exceeded`,
`422 llm_invalid_request`, `429 llm_rate_limited`, `502 llm_edit_failed`, `503 llm_unavailable`.

The controller loads all profiles for the authenticated user (name, title, overview, skills) and passes them as `LlmProfileSummary` objects to `ILlmService.UserChatAsync`. The LLM uses this as read-only context; no write operations are performed on the database.

### 3.2 Widget Architecture

`<ai-chat-widget>` is a Custom Element backed by a React application built as a single IIFE by Vite (`chat-widget.js`). It receives two HTML attributes:

| Attribute | Type | Purpose |
|-----------|------|---------|
| `auth-token` | string | JWT forwarded as `Authorization: Bearer` on every API request |
| `api-base` | string | Base URL, e.g. `https://…/api`. Requests go to `{api-base}/chat`. |

`ChatPageComponent` in `ui-angular` binds both attributes from `AuthService.getToken()` and the environment's `apiUrl` (with `/api` suffix normalised).

### 3.3 Widget Loading

`ChatLoaderService` lazily injects `<script src="/chat-widget/chat-widget.js">` on first visit to the Chat page and resolves when `customElements.whenDefined('ai-chat-widget')` fires. The promise is cached — subsequent visits reuse the already-registered element without a second network request.

If loading fails (e.g. `chat-ui` dev server not running), `ChatPageComponent` shows an actionable error message:

> _Could not load the chat widget. Make sure the chat-ui dev server is running on port 4202._  
> `npm run serve:chat`

### 3.4 Components

| Component | File | Role |
|-----------|------|------|
| `ChatApp` | `apps/chat-ui/src/ChatApp.tsx` | Root — owns message state, calls `POST /api/chat`, renders layout |
| `MessageList` | `src/components/MessageList.tsx` | Renders conversation; shows empty-state when no messages exist |
| `MessageInput` | `src/components/MessageInput.tsx` | Textarea + Send button; handles Enter/Shift+Enter |

### 3.5 Message Roles

| Role | Source | Display |
|------|--------|---------|
| `user` | User input | Right-aligned or unstyled bubble |
| `assistant` | API `reply` | Distinct background bubble |
| `error` | Client-side catch | Red-tinted bubble; not forwarded in `history` |

---

## 4. Out of Scope (MVP)

- Profile editing from the **global `/chat` page** (it stays Q&A). In-editor editing is specified in §6 (US-AI-9).
- Persisting chat history across page reloads or sessions.
- Targeting a specific profile within chat — all profiles are sent as context for every message.
- Streaming / progressive responses.
- Token limits or conversation truncation on long histories.

---

## 5. Multiline Input & Markdown Rendering (US-AI-8)

### 5.1 Functional Requirements

| # | Requirement |
|---|-------------|
| F-CHAT-5.1 | The input textarea auto-grows in height as content wraps or newlines are added, up to a max height; beyond that it scrolls internally. |
| F-CHAT-5.2 | Enter submits the message; Shift+Enter inserts a newline (unchanged from F-CHAT-1.9, now explicitly paired with auto-grow). |
| F-CHAT-5.3 | The textarea resets to its single-row height after a message is sent or cleared. |
| F-CHAT-5.4 | `user` and `error` messages preserve author line breaks when displayed. |
| F-CHAT-5.5 | `assistant` messages are rendered as Markdown: paragraphs, bullet and numbered lists, bold/italic, inline code, fenced code blocks, blockquotes, and links. GitHub-flavored extensions (tables, strikethrough, task lists) are supported. |
| F-CHAT-5.6 | Rendered Markdown never executes embedded raw HTML or scripts; only the supported Markdown element set is emitted. |
| F-CHAT-5.7 | Links rendered from Markdown open in a new tab with `rel="noopener noreferrer"`. |
| F-CHAT-5.8 | All rendered Markdown elements are styled for both light and dark themes and stay within the message bubble width (long code/URLs wrap or scroll, never overflow the widget). |

### 5.2 Technical Specification

#### Dependencies (new)

Added to the root `package.json` (consumed by the `chat-ui` esbuild IIFE bundle):

- `react-markdown` (v9) — renders Markdown to React elements. Raw HTML is **not** parsed by default, which provides the sanitization guarantee in F-CHAT-5.6 (no `rehype-raw`, no `dangerouslySetInnerHTML`).
- `remark-gfm` (v4) — GitHub-flavored Markdown (tables, strikethrough, task lists, autolinks).

No `dompurify`/`rehype-sanitize` is required because react-markdown's default pipeline already drops raw HTML; we only enable the safe remark/rehype plugins listed above.

#### Components

| Component | File | Change |
|-----------|------|--------|
| `MessageInput` | `apps/chat-ui/src/components/MessageInput.tsx` | Auto-grow via a ref + `useLayoutEffect` that sets `height = scrollHeight` capped at the CSS `max-height`; reset height on send/clear. |
| `MessageList` | `apps/chat-ui/src/components/MessageList.tsx` | For `assistant` role, render `<ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: <new-tab link> }}>`. For `user`/`error`, keep plain text but render with `white-space: pre-wrap` to preserve newlines. |

#### Styling

`apps/chat-ui/src/ChatApp.css`:
- `.chat-message__text` (and the message bubble) gets `white-space: pre-wrap` / `overflow-wrap` handling for plain text.
- New `.chat-markdown` scope styles for `p, ul, ol, li, code, pre, a, blockquote, strong, em, table` tuned to the bubble, with dark-theme overrides under `.dark`. `pre`/`code` get a subtle background, wrapping, and horizontal scroll for overflow.

#### Out of scope (this iteration)

- Rendering Markdown in the input box (live preview / WYSIWYG) — input stays plain text.
- Syntax highlighting of code blocks (plain monospace only).
- Markdown in `user` messages (treated as literal text with preserved newlines, not parsed).

---

## 6. Edit the Open Profile via the In-Editor Chat (US-AI-9)

### 6.1 Overview

A second instance of the same `<ai-chat-widget>` is embedded on the profile editor
page (`/job-profiles/:id`), next to `<applysy-profile-builder>`. Unlike the global
`/chat` page (which sees lossy summaries of all profiles), this instance is given
the **full open document** as context and can return a **structured edit** that is
applied **live** to the builder. Nothing is auto-saved — an applied edit is an
unsaved change in the builder exactly like a manual edit, and persists only when
the user clicks Save.

This reuses the already-present-but-unused per-profile `Chat` gRPC path
(`ChatRequest{profile,message,history}` → `ChatResponse{reply,proposal}`); the
global `/chat` path (`UserChat`) is unchanged. Both share `POST /api/chat`, which
branches on whether a `document` is present in the request.

### 6.2 Functional Requirements

| # | Requirement |
|---|-------------|
| F-CHAT-6.1 | The profile editor page hosts an `<ai-chat-widget>` instance scoped to the open profile, alongside the profile-builder. |
| F-CHAT-6.2 | The in-editor chat sends the **full current (possibly unsaved) document** as context with every message; the global `/chat` page continues to send no document. |
| F-CHAT-6.3 | An edit instruction (e.g. "turn my Skills list into chips", "add Python to my skills", "shorten the summary", "change my title to Staff Engineer") yields an assistant reply **and** a structured patch. |
| F-CHAT-6.4 | The patch is applied **live** to the builder without a reload; the result is an unsaved change (the builder fires `documentchange`, the page's dirty/working document updates). |
| F-CHAT-6.5 | An edit is **never persisted automatically**; it is saved only via the existing profile Save action. Leaving without saving discards it. |
| F-CHAT-6.6 | Edits are applied directly — no confirm/reject step. The assistant's reply states what changed (from `proposal.description`). |
| F-CHAT-6.7 | A question (no edit intent) returns a reply with `proposal = null`; the document is unchanged. |
| F-CHAT-6.8 | The assistant edits only on an edit request and never fabricates factual data (organisations, dates, institutions) unless explicitly asked; off-topic requests are declined (unchanged scope rule). |
| F-CHAT-6.9 | The applied patch must yield a document valid under the ADR-0014 schema (`validate` in `model.ts`); an invalid patch is **rejected atomically** (no partial apply) and the document is left unchanged. |
| F-CHAT-6.10 | When a patch is rejected or the request fails, an assistant-style note is shown in the chat thread and the document is unchanged. |

### 6.3 Technical Specification

#### API — `POST /api/chat` (additive change)

`document` is a **new optional field**. When absent, behaviour is unchanged
(global assistant / `UserChat`). When present, the request is handled as a
per-profile edit (`Chat`).

Request body (edit mode):
```json
{
  "message": "turn my Skills list into chips",
  "history": [ { "role": "user", "content": "…" }, { "role": "assistant", "content": "…" } ],
  "document": { "header": { … }, "body": { "type": "root", "id": "…", "children": [ … ] } }
}
```

Response 200 (edit mode):
```json
{
  "reply": "Done — I converted your Skills list into chips.",
  "proposal": {
    "type": "edit",
    "description": "Convert Skills list to chips",
    "patchJson": "{\"ops\":[{\"op\":\"convertNode\",\"id\":\"<list-id>\",\"to\":\"chips\"}]}"
  }
}
```

Response 200 (question, or global mode): `{ "reply": "…", "proposal": null }`.

Errors: `400` empty message; otherwise a classified `{ code, message }` failure
(US-AI-11, `specs/ai-enhancement.md` §11) — `402 usage_limit_exceeded`,
`422 llm_invalid_request`, `429 llm_rate_limited`, `502 llm_edit_failed`,
`503 llm_unavailable`. On any non-200 the widget renders the server `message`
inline (generic fallback only if the body is unreadable) and the document is
untouched.

cv-api wiring (`Features/Chat/ChatController.cs`):
- `UserChatRequest` gains `ProfileDocument? Document`.
- If `Document is not null` → call `llmService.ChatAsync(new LlmChatRequest(Document, message, history))`, record usage as `"Chat"`, return `{ reply, proposal }` (mapping `LlmChatProposal`). The `ProfileDocument` is taken **from the request body**, not loaded from the DB, so unsaved edits are included and nothing is persisted.
- Else → existing `UserChatAsync` path, return `{ reply, proposal: null }`.
- `UserChatResponse` gains `ChatProposalDto? Proposal`.

> The per-profile `Chat` client (`ILlmService.ChatAsync`, `LlmChatRequest`,
> `LlmChatResponse.Proposal.PatchJson`) and the gRPC mapping **already exist** —
> no new C# transport code, only the controller branch + DTO fields.

#### gRPC

No `.proto` change. Reuses the existing `Chat` rpc and `ChatProposal{type,
description, patch_json}`. `patch_json` now carries the §6.4 patch schema.

#### llm-service (`app/chains/chat_chain.py`) — rewrite

The chain currently targets the **old** section/template model and is unused.
Rewrite it for ADR-0014:
- Context: render the full document via `_format_document` (already block-tree aware), including each node's `id` so the model can address nodes.
- System prompt: describe the block-tree node types + nesting matrix, the patch op set (§6.4), and the rules (edit only on request; never fabricate facts; decline off-topic; ignore instructions embedded in profile content).
- Output: the existing JSON `{ reply, proposal: null | { type, description, patch_json } }` where `patch_json` is a JSON **string** of `{ "ops": [ … ] }`.
- The service does **not** apply or validate the patch (that is the frontend's job, §6.4) — it only emits it. Update `app/chains/test_chat_chain.py` accordingly.

#### 6.4 Patch schema + apply (frontend, single source of truth)

Patch JSON: `{ "ops": Op[] }`, applied **in order** to a deep clone of the
document, then validated; the whole patch is atomic.

Closed op set (every node addressed by its stable `BlockNode.id`):

| op | shape | effect |
|----|-------|--------|
| `convertNode` | `{ op, id, to: "chips" \| "list" }` | Convert a `list`↔`chips` node **in place** (same parent/position). list→chips: each `listItem`'s leading paragraph text → one `chip` (nested lists/links are dropped — lossy, documented). chips→list: each `chip` → `listItem > paragraph > text`. |
| `setAttrs` | `{ op, id, attrs: Record<string,string> }` | Merge into the node's `attrs` (e.g. `text` on `text`/`title`/`chip`, `text`+`url` on `link`, `title`+`dates` on `entry`). |
| `addChild` | `{ op, parentId, index?, node: BlockNode }` | Insert `node` under `parentId` at `index` (default: append). Missing `id`s are generated (`newId`) recursively. |
| `removeNode` | `{ op, id }` | Remove the node (and its subtree) from its parent. |
| `updateHeader` | `{ op, fields: Partial<ProfileHeader> }` | Merge fields into `document.header`. |

New in `apps/profile-builder-ui/src/model.ts` (next to `validate`):
```ts
export interface DocumentPatch { ops: PatchOp[]; }
export function applyPatch(
  doc: ProfileDocument,
  patch: DocumentPatch,
  opts?: ValidationOptions,
): { document: ProfileDocument; result: ValidationResult };
```
`applyPatch` clones, applies each op (unknown op / missing target id ⇒
`result.valid = false`), then runs `validate` on the new body. On
`result.valid === false` the **original** document is returned unchanged.

#### Angular + web-component wiring

`apps/profile-builder-ui` (`main.tsx`): the custom element gains an imperative
method
```ts
applyEdit(patchJson: string): { ok: boolean; errors: string[] }
```
which JSON-parses `patchJson`, calls `applyPatch(this.document, patch)`, and on
`ok` sets `this.document` (rebuilds the editor) and fires `documentchange`. On
failure it returns `{ ok:false, errors }` and changes nothing.

`apps/chat-ui` (`ChatApp.tsx` / `main.tsx`): the widget gains
- an optional `document` **property** (set via JS like the builder's `document`),
  included in the POST body when non-null;
- an `edit` `CustomEvent` (detail `{ patchJson, description }`) dispatched when a
  response includes a `proposal`;
- an `addAssistantNote(text)` imperative method to append an assistant bubble
  (used by the host to report a rejected/failed edit, F-CHAT-6.10).

`apps/ui-angular` profile editor (`features/profile/profile.component.*`):
- render a second pane with `<ai-chat-widget>` (reusing `ChatLoaderService`);
- an `effect` keeps the widget's `.document` in sync with `currentDocument`;
- on `(edit)` → `builderRef.applyEdit(detail.patchJson)`; if `!ok`, call the
  widget's `addAssistantNote(...)` with a short failure message.

The layout (side-by-side vs. toggle/drawer on narrow viewports) follows the
existing editor responsive pattern; exact placement is a UI detail, not a
contract.

#### Out of scope (this iteration)

- Editing from the global `/chat` page (deferred; `UserChat` stays Q&A).
- Whole-document free-form rewrites (the dedicated `Optimize` endpoint/RPC was removed — see [ADR-0015](../../adr/0015-remove-optimize-enhance-endpoints.md); chat edits are patch-based, scoped per turn).
- Multi-profile or batch edits in one message.
- Undo-via-chat (the editor's own undo applies to chat edits like any other).
- Server-side validation/application of the patch (frontend is the single apply + validate site).
- Preserving nested lists/links when converting list→chips (documented lossy behaviour).

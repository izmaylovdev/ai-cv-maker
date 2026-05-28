# Spec: AI Career Assistant Chat

**Source user stories:** US-AI-4  
**Feature area:** Conversational AI assistant  
**Status:** Draft

---

## 1. Overview

A dedicated Chat page in `ui-angular` embeds `<ai-chat-widget>` — a self-contained React application packaged as an IIFE Custom Element. The widget sends messages to `POST /api/chat`, which loads the authenticated user's profile summaries as read-only context so the assistant can answer profile-specific questions.

Profile editing via chat (proposing and persisting changes) is out of scope for MVP; the current assistant is Q&A only.

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
**Response 502:** `"Chat failed: <upstream error>"` — LLM service unavailable.

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

- Profile editing via chat (proposing, reviewing, and persisting field changes). `ProposalCard` exists as a placeholder for a future iteration.
- Persisting chat history across page reloads or sessions.
- Targeting a specific profile within chat — all profiles are sent as context for every message.
- Streaming / progressive responses.
- Token limits or conversation truncation on long histories.

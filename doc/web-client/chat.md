# AI Chat Assistant

One React web component, `<ai-chat-widget>`, serves two purposes: a read-only
career assistant on `/chat`, and an editing assistant docked beside the profile
editor that can change the open document live.

**Code:** `apps/chat-ui` (React IIFE custom element), `apps/cv-api/Features/Chat/`,
`apps/llm-service/app/chains/chat_chain.py`, hosted by
`apps/ui-angular/src/app/features/chat/` and `.../features/profile/`
**See also:** [profile-editing.md](profile-editing.md) ·
[ai-usage.md](ai-usage.md) (cost, limits, prompt caching) ·
[ADR-0015](../adr/0015-remove-optimize-enhance-endpoints.md) (chat replaced the old enhance/optimize endpoints)

---

## Two instances, one widget

| | Global assistant (`/chat`) | In-editor AI Editor (`/job-profiles/:id`) |
|---|---|---|
| Context | Lossy summaries of all the user's profiles | The **full current document**, including unsaved edits |
| Can edit | No — Q&A only | Yes — returns a structured patch applied live |
| Empty state | Centered landing splash ("How can I help you?") | Conversation layout with a muted hint, input already pinned at the bottom |
| gRPC path | `UserChat` | `Chat` |

Both post to `POST /api/chat`. The request branches on one thing: whether a
`document` is present.

---

## Conversation behaviour

The widget is built from [LlamaIndex Chat UI](https://ui.llamaindex.ai/)
(`@llamaindex/chat-ui`) components: a message thread with user and assistant
avatars, and a Chat UI composer form with a send button
([ADR-0022](../adr/0022-llamaindex-chat-ui-widget.md)).

Messages are free text. Each request carries the session's full history (the
last 20 turns), so the assistant keeps context. Error bubbles are left out of
that history. While a reply is in flight, a loading indicator shows and the
thread scrolls to the newest message. Send is disabled when the input is empty
and while a request is in flight.

The input is a textarea that grows as text wraps, up to a max height. Past that
it scrolls internally. It returns to one row after sending. **Enter** submits and
**Shift+Enter** inserts a newline. While an IME composition is active, Enter
does not submit.

Assistant replies render as GitHub-flavored Markdown: paragraphs, lists,
bold/italic, inline and fenced code, blockquotes, tables, task lists and links.
Fenced code blocks are syntax-highlighted with highlight.js, which covers the
common languages. User messages stay plain text, with the author's line breaks
preserved.

Raw HTML is never parsed. The Markdown pipeline has no raw-HTML step, so no
sanitizer is needed. Markdown links open in a new tab with
`rel="noopener noreferrer"`. Dollar signs are escaped, so amounts like "$120k"
stay text and never become maths. Long code and URLs wrap or scroll inside the
bubble.

Errors appear in a distinct bubble with `role="alert"`, showing the server's
message verbatim (see [API](#api)).

The widget follows the app theme via the `.dark` class on `<html>`.

### Styling and bundle

The widget renders in light DOM, and every rule it ships is scoped under the
`ai-chat-widget` selector. That includes Tailwind's preflight and the
shadcn-style colour tokens. None of its CSS can match anything outside the
element, so the host page looks the same with or without the widget. The rules
are unlayered, so the host's own unlayered CSS cannot override the widget's
utilities.

Chat UI features the widget never renders are replaced with no-op stubs at build
time, so they stay out of the bundle: the PDF viewer, the document and code
editors, LlamaDeploy, and the vaul drawer. highlight.js ships only its common
languages, and KaTeX ships without its web fonts. `chat-widget.js` is about
1 MB minified (about 320 KB gzipped). A build check fails the tests if it grows
past 1.2 MiB or if any shipped rule escapes the `ai-chat-widget` scope.

---

## Editing the open profile

The in-editor instance sends the document currently on screen — including unsaved
changes — with every message. An edit instruction ("turn my Skills list into
chips", "add Python to my skills", "shorten the summary") comes back as a reply
**plus** a structured patch; a plain question comes back with `proposal: null`
and the document untouched.

Patches are applied **directly** — there is no confirm/reject step; the reply
states what changed. Applying a patch is an ordinary unsaved edit: the builder
fires `documentchange`, and nothing is persisted until the user clicks Save.
Leaving the page without saving discards it.

The patch op set is closed and addresses nodes by their stable `id`:

| Op | Effect |
|---|---|
| `convertNode` | Convert a node to `chips` or `list` |
| `setAttrs` | Merge attrs on a node |
| `addChild` | Insert a node under a parent at an index |
| `removeNode` | Remove a node |
| `updateHeader` | Patch letterhead fields |

llm-service only *emits* the patch — validation and application are the
frontend's job. The result must be valid under the block-tree schema; an invalid
patch is **rejected atomically** (never partially applied) and surfaces as an
assistant-style note in the thread with the document unchanged.

**Guardrails.** The assistant edits only when asked, never fabricates factual
data (organisations, dates, institutions) unless explicitly told to, declines
off-topic requests, and ignores instructions embedded inside profile content.

---

## Cross-profile reads

The AI Editor can enumerate the user's *other* saved profiles and read one in
full, so a user can say "pull my education from my data-science profile" without
opening it. llm-service has no database access — cv-api pre-fetches the
authenticated user's profiles and passes them down, and the agent uses tool calls
to look them up on demand.

- Tools fire only when the request needs them; anything answerable from the open
  document alone produces no tool calls.
- Only the caller's own profiles are ever supplied.
- The **open** profile is excluded from the list, so the agent cannot offer it as
  a source for populating itself.
- Reads never mutate the source profile; a proposal still targets only the open
  document.
- An unknown id returns a tool error the agent reports in its reply.
- When another profile is used as a source, the reply names it.
- A conversational reply after a tool call (e.g. "which profile should I use?")
  is shown verbatim — not reported as a malformed response.

---

## The sidebar

The AI Editor lives in a slide-in panel toggled by an "AI Editor" button that
reflects its state (`aria-expanded`, pressed styling). On `lg+` screens the open
panel **pushes** the document column rather than overlaying it; below that it
slides over the viewport. The ✕ in the panel header, the toggle button, and
Escape all close it. Open/closed state is persisted in `localStorage`, defaulting
to closed.

Closing only hides the panel in CSS — the element stays mounted, so the thread
and the live document binding survive open/close cycles.

On `lg+` a drag handle on the panel's inner edge resizes it live, clamped to
`[320px, min(720px, 66vw)]` and re-clamped on window resize; the document
column's right margin tracks the width exactly. The width persists in
`localStorage`, defaulting to 384px. The handle is focusable
(`role="separator"`, `aria-label="Resize AI Editor panel"`, live `aria-valuenow`)
and ArrowLeft/ArrowRight adjust the width by a fixed step. Below `lg` there is no
handle. Resizing never remounts the widget.

---

## API

### `POST /api/chat`

```json
{
  "message": "turn my Skills list into chips",
  "history": [ { "role": "user", "content": "…" }, { "role": "assistant", "content": "…" } ],
  "document": { "header": { … }, "body": { … } },
  "sessionId": "b1f2c3d4-…"
}
```

`document` is optional — present for the in-editor chat, absent for the global
assistant. `sessionId` is optional and groups the conversation into one Langfuse
session (see [ai-usage.md](ai-usage.md)); omitting it is a no-op.

**200:** `{ "reply": "…", "proposal": null | { "type", "description", "patchJson", "text" } }`

Failures are structured `{ code, message }` bodies where `message` is always a
clean user-facing sentence — never a raw exception or gRPC status string. The
widget renders it in a distinct `error` bubble, falling back to one generic
sentence only if the body is unreadable. A failed request leaves the document
untouched and the conversation usable.

| Status | `code` | Cause |
|---|---|---|
| `400` | — | Empty message |
| `402` | `usage_limit_exceeded` | Spending allowance reached ([ai-usage.md](ai-usage.md)) |
| `422` | `llm_invalid_request` | Guard/scope/validation rejection; the message is the assistant's own explanation |
| `429` | `llm_rate_limited` | Provider rate limit |
| `502` | `llm_failed` | llm-service hit an unexpected error (gRPC `Internal`: a provider or SDK failure, or a bug). The message names no cause and just asks the user to try again |
| `503` | `llm_unavailable` | llm-service unreachable or timed out |

Classification happens in dedicated `IExceptionHandler`s, not in a controller
catch-all, and applies the same way to the global and in-editor assistant.
An edit the model cuts off at its output-token cap, or a reply that is not the
expected JSON envelope, is not an error at all. llm-service answers it with a
normal `200` reply (a nudge to split the edit, or a "try rephrasing" note) and
no proposal, so the document stays unchanged.

A per-profile variant, `POST /api/job-profiles/{id}/chat`, exists on the profile
controller and speaks the same `{ reply, proposal }` shape.

---

## Not implemented

- Persisted conversation history (threads live only in the browser session).
- Markdown rendering or preview in the input box.
- Markdown parsing of user messages.
- Streaming replies: `/api/chat` is request/response.
- These Chat UI features: file upload, citations, canvas/artifacts, starter
  questions, and regenerate/stop.

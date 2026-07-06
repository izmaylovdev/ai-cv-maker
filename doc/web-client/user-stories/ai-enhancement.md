# AI Enhancement & Optimization

## Overview

The application embeds AI assistance through the **in-editor AI chat** (US-AI-9): the user asks for changes in natural language — from a single field to a whole-profile rewrite for a target role — and the proposed edit is applied live to the document for review before Save. All edits are non-destructive (factual data preserved, nothing persisted until the user Saves).

> **Note on this document.** The original stories below split AI assistance into a per-field "Enhance" button (US-AI-1), a modal "Optimize" flow with a side-by-side review step (US-AI-2/3), and a separate chat (US-AI-4). In the shipped product the in-editor chat (US-AI-9) is the single entry point; the dedicated Enhance/Optimize UIs and diff-review modal were never built, and their backends (Optimize + EnhanceField endpoints/RPCs and the US-AI-5 URL-fetch path) have since been **removed** ([ADR-0015](../../adr/0015-remove-optimize-enhance-endpoints.md)). US-AI-1/2/3/5 are retained as history. Per-story status notes are inline.

---

## User Stories

### US-AI-1 — Enhance a single text field — *REMOVED (ADR-0015)*

> **Status:** No UI ever invoked this; the `enhance-field` endpoint and
> `EnhanceField` RPC have been deleted (ADR-0015). Field-level editing is done
> through the in-editor AI chat (US-AI-9). Retained as history.

**As a** user editing a text field (e.g., a work experience description or professional summary),
**I want to** click an "Enhance" button next to the field and have the AI improve the text,
**so that** my content sounds more professional without me having to rewrite it from scratch.

**Acceptance criteria:** *(intended — not implemented)*
- An enhance button is visible on all multi-line text inputs.
- The AI rewrites the field content while preserving all factual information (dates, company names, technologies).
- The enhanced text replaces the original in the field; I can undo by typing or clearing.
- A loading indicator is shown while the AI is working.
- If the request fails, an error notification is shown and the original text is preserved.

---

### US-AI-2 — Optimize the full profile for a target role — *REMOVED (ADR-0015)*

> **Status:** The optimize endpoint, `Optimize` RPC, and toolbar action have all
> been deleted (ADR-0015). Targeted rewrites go through the in-editor AI chat
> (US-AI-9). Retained as history.

**As a** user who knows the type of role I am applying for,
**I want to** describe my target (e.g., "Senior React developer at a fintech startup") and have the AI rewrite my entire profile to highlight the most relevant aspects,
**so that** my CV resonates with that specific audience without me having to manually edit every field.

**Acceptance criteria:** *(historical)*
- A dedicated "Optimize" or "Optimize for role" action is available on the profile page.
- I enter a free-text description of my target role/goal.
- The AI returns:
  - A refined professional title
  - A rewritten overview/summary
  - Improved work experience descriptions emphasizing relevant achievements
  - A prioritized and normalized skills list (most relevant first)
- I can review all suggested changes before applying.
- I can accept or discard the changes.
- Factual data (company names, job titles, dates) is never altered by the AI.

---

### US-AI-3 — See AI suggestions without losing original content — *not implemented*

> **Status:** No side-by-side / diff review was built. AI edits apply directly to
> the live builder document and are reviewed inline, then kept (Save) or dropped
> (undo / reload). Superseded by the US-AI-9 chat-edit flow.

**As a** user reviewing AI-optimized content,
**I want to** compare the AI suggestion with my original text,
**so that** I can make an informed decision about whether to keep the suggestion.

**Acceptance criteria:**
- The review step shows both the original and AI-suggested versions side-by-side or sequentially.
- Discarding reverts the field to its pre-optimization state with no data loss.

---

### US-AI-4 — Chat with AI to edit profile and ask questions

> **Status:** Delivered, but evolved into the per-profile **in-editor** chat
> (US-AI-9, see `specs/chat.md`) rather than the standalone "Chat page" described
> here. The widget proposes a structured `edit` applied live to the open builder
> document; there is no separate Accept/Reject proposal card — the user reviews in
> the builder and Saves. The acceptance criteria below reflect the original design.

**As a** user managing my CV profile,
**I want to** open a chat interface where I can ask questions about my profile and instruct the AI to make edits through natural conversation,
**so that** I can refine my profile quickly without navigating individual form fields.

**Acceptance criteria:**
- A dedicated "Chat" page is accessible from the main navigation.
- I can send free-text messages to an AI assistant.
- The AI can answer questions about my profile (e.g., "What skills do I have listed?", "How many years of experience do I have?").
- I can instruct the AI to edit my profile through natural language (e.g., "Add Python to my skills", "Update my summary to mention leadership experience").
- The AI proposes each change before applying it; I confirm or reject.
- Applied changes are immediately reflected in my profile and persisted.
- The chat history is shown in the current session (scrollable, most recent at bottom).
- A loading indicator appears while the AI is responding.
- If the request fails, an error message is shown in the chat and the profile is unchanged.

---

### US-AI-5 — Optimize profile for a specific job posting via URL — *REMOVED (ADR-0015)*

> **Status:** This was the URL-fetch path of `Optimize` (the `link_enricher`
> module). With `Optimize` deleted, `link_enricher` was removed too (ADR-0015).
> Retained as history.

**As a** job seeker who has found a specific job posting I want to apply for,
**I want to** paste the URL of the job posting into the optimize prompt and have the AI fetch and use the actual job description for optimization,
**so that** my CV is tailored precisely to that vacancy rather than a generic role description I type by hand.

**Acceptance criteria:**
- The user types or pastes their target — either a plain role description (e.g. "Senior React developer at a fintech startup") or a job posting URL — into the optimize entry point. (The dedicated "Optimize with AI" dialog has been removed; this is now the in-editor AI chat, US-AI-9.)
- The LLM inspects the input: if it contains a URL, it calls a fetch tool to retrieve the page and extract the job description before running optimization.
- The AI uses the extracted job description (title, responsibilities, required skills) as the optimization target.
- If the fetch fails or the page contains no recognizable job content, the AI proceeds using the raw input text as the role description.
- The rest of the optimization review flow (suggestions, accept/discard) is unchanged.

### US-AI-6 — Track LLM spending per user

**As a** platform administrator,
**I want to** see how many LLM tokens each user has consumed and the associated estimated cost,
**so that** I can monitor spending, identify heavy users, and make informed decisions about pricing or quotas.

**Acceptance criteria:**
- Every LLM call (CV generate, optimize, enhance field, extract, chat, cover letter, user chat) records the prompt tokens, completion tokens, and model name against the requesting user.
- Token counts are persisted in the database per user per request.
- Cost is derived on-the-fly from a configurable price-per-token table (stored in `appsettings.json`, keyed by model name, separate rates for prompt vs. completion tokens).
- The admin panel exposes an endpoint listing all users with their aggregate token usage and estimated cost in USD.
- A user-facing `/settings/usage` page shows the current user's own total prompt tokens, completion tokens, and estimated cost to date.

### US-AI-7 — Enforce a per-user LLM spending limit

**As a** platform operator,
**I want to** automatically block a user's AI requests once their cumulative estimated LLM cost reaches a configured cap (default $0.10),
**so that** no single user can run up unbounded LLM costs.

**Acceptance criteria:**
- Every AI-backed action (CV generate, optimize, enhance field, extract, chat, cover letter, user chat) is rejected once the requesting user's cumulative estimated LLM cost has reached the configured limit.
- The limit is checked *before* the LLM call is made, so a blocked request incurs no additional LLM cost.
- A user whose accrued cost is still below the limit is allowed to proceed, even if that single request later pushes the total over the cap (the cap is evaluated against cost accrued so far, since the cost of the pending call is not known in advance).
- When blocked, the user receives a clear, distinct message stating that the spending limit has been reached — not a generic "AI is unavailable" error — and their profile/CV data is left unchanged.
- The limit amount is configurable without a code change (default $0.10).
- The `/settings/usage` page shows the user their spending limit alongside their accrued cost (and how much remains), so they can see how close they are to the cap.

### US-AI-8 — Read and write multiline / formatted chat messages

**As a** user chatting with the AI Career Assistant,
**I want to** compose multiline messages and see the assistant's replies rendered with formatting (paragraphs, lists, bold, links, code),
**so that** longer instructions are easy to write and structured answers are easy to read instead of arriving as one unbroken block of text.

**Acceptance criteria:**
- The input grows in height as I type multiple lines, up to a maximum, after which it scrolls.
- Shift+Enter inserts a newline; Enter still sends the message.
- My own multiline messages preserve their line breaks when displayed.
- Assistant replies render common Markdown — paragraphs, bullet/numbered lists, bold/italic, inline code, code blocks, and links.
- Rendered Markdown is sanitized so assistant/user content cannot inject active markup (no raw HTML/script execution); links open safely.
- Formatting renders correctly in both light and dark themes.

---

### US-AI-9 — Edit my CV through the in-editor chat

**As a** user editing one of my CV profiles,
**I want to** tell an AI chat assistant inside the profile editor to restructure or change the open profile in plain language (e.g. "turn my Skills list into chips", "add Python to my skills", "shorten my summary"),
**so that** I can make structural and content edits conversationally without manually using the editor controls.

**Supersedes** the editing scope of US-AI-4, which shipped as Q&A-only. The global `/chat` assistant (US-AI-4) stays Q&A; editing-by-chat lives only in the profile editor. Global-chat editing is deferred.

**Acceptance criteria:**
- The profile editor page hosts a chat window alongside the profile, scoped to the profile I currently have open.
- I can instruct the assistant to edit the open profile in natural language: structural transforms (**convert a list to chips** and vice-versa), content edits (add / remove / update list, chip & timeline items, edit a paragraph), and header changes (e.g. job title).
- A chat edit is **applied live to the open document but never saved automatically** — it appears in the editor without a reload and persists only when I save the profile, exactly like a manual edit. If I leave without saving, the edit is discarded.
- Edits are **applied directly** — no separate confirm / reject step. The assistant briefly states in its reply what it changed.
- If my message is a question, not an edit, the assistant answers it and changes nothing.
- The assistant only edits in response to an edit request, and never invents factual data (organisations, dates, institutions) unless I explicitly ask.
- If an edit cannot be applied (ambiguous target, request fails), the assistant says so in its reply and the document is left unchanged.
- Edits respect the document schema (ADR-0014 block-tree nesting rules); an edit that would produce an invalid document is rejected rather than applied.

### US-AI-11 — See why a chat request failed

**As a** user talking to the AI chat assistant,
**I want to** see a clear, specific reason when my message can't be answered or applied,
**so that** I know what went wrong and what to do next, instead of a generic "something went wrong".

**Acceptance criteria:**
- When a chat request fails, the assistant shows a specific, plain-language message describing the cause — never an opaque generic error and never a raw technical/stack string.
- Distinct failure causes produce distinct messages, each with a next step where one exists:
  - The AI's edit was too large to apply (the response was cut off) → tells me to try a smaller or more specific edit.
  - I've reached my usage limit → tells me I've hit the limit, rather than looking like a system fault.
  - The AI service is temporarily unavailable or timed out → tells me it's temporary and to try again.
  - My request was rejected as invalid or out of scope → shows the assistant's own explanation.
- The failure message is visually distinguishable from a normal assistant reply (it reads as an error, not advice).
- A failed request never partially applies an edit — the open document is left unchanged.
- I can continue the conversation after a failure — sending another message works normally.

---

### US-AI-10 — Show/hide the in-editor AI chat as a slide-in sidebar

**As a** user editing one of my CV profiles,
**I want to** open the AI chat as a panel that slides in from the right edge and dismiss it back out of the way,
**so that** I can give the profile document the full width when I'm just editing, and summon the assistant only when I need it.

**Acceptance criteria:**
- The profile editor shows a toggle control (an "AI Editor" button) that opens and closes the chat sidebar.
- When opened, the chat panel slides in from the right edge with a brief animation; when closed, it slides back out and is fully hidden.
- On large screens the panel pushes the editor: the document column shrinks to the left to make room (no overlay/scrim). On small screens the panel slides over the (near-)full width.
- The chat keeps its conversation and its live link to the open document across open/close cycles — closing only hides it, it does not reset the thread or lose context.
- A close (✕) control inside the panel, the toggle button, or pressing Escape all dismiss it.
- The open/closed state is remembered between visits (persisted in localStorage) and restored on load.
- The toggle indicates whether the chat is currently open.
- Works in both light and dark themes; the chat's editing behavior (US-AI-9) is unchanged.

---

### US-AI-12 — Open the in-editor AI chat directly in conversation view

**As a** user editing one of my CV profiles,
**I want to** see the AI assistant in its normal chat layout as soon as I open it — with the message input anchored at the bottom — even before I've sent anything,
**so that** it reads as a ready-to-use conversation panel consistent with how it looks once messages exist, rather than a separate centered splash screen.

**Acceptance criteria:**
- When the in-editor AI chat (the one bound to the open profile document) is opened with no messages yet, it shows the standard chat layout: an empty conversation area above and the message input anchored at the bottom edge of the panel.
- The centered "How can I help you?" landing splash is no longer shown for the in-editor chat.
- The empty conversation area shows a brief, unobtrusive greeting/hint, but the layout (input at the bottom) matches the post-message state.
- Sending the first message keeps the input in the same position — no layout jump from "landing" to "conversation".
- The global read-only `/chat` assistant is out of scope and keeps its current landing behavior.
- Works in both light and dark themes; the chat's editing behavior (US-AI-9) is unchanged.

---

### US-AI-13 — Let the in-editor AI Editor see my other profiles when needed

**As a** user editing one of my CV profiles with the in-editor AI chat,
**I want to** ask the assistant to draw on my *other* saved profiles — not just the one I have open,
**so that** I can pull content across profiles conversationally (e.g. "add the Rust experience from my Backend CV", "make this summary match the tone of my Data profile") without copy-pasting between profiles myself.

**Supersedes** the single-profile scope of US-AI-9 for read purposes only: the assistant still edits **only the open document**, but it may now *read* my other profiles to inform an edit or answer.

**Acceptance criteria:**
- When a request needs information from my other profiles, the assistant can discover that I have other profiles and read their content on demand — I don't have to open or paste them.
- The assistant only reaches for other profiles **when the request actually calls for it**; ordinary edits and questions about the open document behave exactly as before (no change to US-AI-9).
- Only my own profiles are ever visible to the assistant; it can never see another user's profiles.
- Any edit the assistant makes still applies **only to the currently open document** and is never auto-saved — reading another profile never modifies it.
- If I ask about a profile that doesn't exist or can't be read, the assistant says so and changes nothing.
- The assistant briefly notes when it used another profile as a source (e.g. "pulled from your *Backend Engineer* profile"), so it's clear where borrowed content came from.
- The profile I currently have open is **not** offered as one of my "other" profiles — the assistant never lists it as a source to populate itself from.
- When the assistant asks me a clarifying question (e.g. "which profile should I use as the source?"), I see that question and can answer it — I'm never shown a generic "unexpected format" error in its place.
- Cross-profile reads respect the same scope/safety rules as US-AI-9 (no inventing facts, stays within CV/career scope, ignores instructions embedded in profile content).

---

### US-AI-14 — See my per-user billing balance and get blocked when it runs out

**As a** signed-in user whose AI activity costs money,
**I want to** open a Billing page that shows my own dollar balance — a starting allowance minus what my AI usage has cost so far — and have the app stop my AI requests when that balance reaches zero,
**so that** I can see exactly how much AI budget I have left and I'm never surprised by usage beyond my allocated funds.

**Supersedes** the single global spending cap of US-AI-7 for the enforcement threshold: the limit is now each user's *own* allowance rather than one value shared by everyone. Token tracking and cost estimation (US-AI-6) are unchanged and reused. Adding funds (top-up / payment) is explicitly out of scope for this story.

**Acceptance criteria:**
- A "Billing" item appears in the main navigation for authenticated users; clicking it navigates to `/billing`.
- The Billing page shows, in US dollars: my current **balance** (funds remaining), my total **allowance**, and the **amount spent** on AI to date. Balance equals allowance minus amount spent and is never shown below $0.
- The page also shows the token consumption (prompt tokens and completion tokens) that produced the spend, so the dollar figure is explainable.
- Two different users see independent balances: one user spending AI budget does not change another user's balance or allowance.
- After I use an AI action, my Billing page reflects the increased amount spent and reduced balance on reload.
- When my balance is exhausted (amount spent has reached my allowance), any AI-backed action is blocked with a clear, distinct message that I've run out of billing balance — not a generic "AI is unavailable" error — and my profile/CV data is left unchanged.
- A user whose balance is still above $0 is allowed to proceed, even if that single request later pushes the spend past the allowance (the check is against spend accrued so far, since the pending call's cost is unknown in advance).
- The Billing page is protected by the auth guard: visiting `/billing` while signed out redirects to login.
- The Billing page renders correctly in both light and dark themes.

---

### US-AI-15 — Resize the in-editor AI chat sidebar

**As a** user editing one of my CV profiles with the in-editor AI chat (US-AI-10),
**I want to** drag the chat sidebar's edge to make it wider or narrower,
**so that** I can trade screen space between the document and the assistant to suit the task — a wide panel to read a long AI reply, a narrow one to keep the document in view.

**Acceptance criteria:**
- The open chat sidebar shows a drag handle along its left (inner) edge; the cursor changes to a horizontal-resize cursor when hovering it.
- Dragging the handle left widens the panel and dragging right narrows it, live, following the pointer as I drag.
- On large screens the document column keeps making room for the panel as it resizes — it is pushed by exactly the panel's current width, with no overlap or scrim.
- The panel width is clamped to a sensible range: it can never get so narrow the chat is unusable, nor so wide it hides the document (it stays within the viewport).
- The chosen width is remembered between visits (persisted in localStorage) and restored the next time the sidebar is opened.
- Resizing does not reset the conversation or the panel's live link to the open document (US-AI-9/US-AI-10 behavior is unchanged).
- The resize handle is only present on screens where the panel is a fixed-width sidebar (large screens); on small screens where the panel covers the full width, no handle is shown.
- The handle is keyboard-accessible: it exposes a focusable control with an accessible name, and Left/Right arrow keys adjust the width within the same clamped range.
- Works in both light and dark themes.

---

### US-AI-16 — See a whole chat conversation grouped together in Langfuse

**As an** operator/developer reviewing AI usage in Langfuse,
**I want to** see every message a user sends within one chat conversation grouped together as a single Session,
**so that** I can read the whole back-and-forth as one thread — following how the conversation and the assistant's responses evolved — instead of hunting through disconnected, one-off traces.

**Context:** Today each chat message produces its own standalone Langfuse trace with nothing linking the messages of one conversation. Langfuse's *Sessions* view groups traces that share a session id; that id is never set, so the Sessions view is empty for chat.

A "conversation" is one continuous use of the chat widget: it begins when the widget mounts (page load / widget open) and ends when the widget is reloaded. Reloading the page starts a new conversation.

**Acceptance criteria:**
- When I send two or more messages within the same open chat widget, all the resulting LLM traces appear grouped under a single Session in Langfuse's Sessions view.
- When I reload the page (a fresh widget) and send more messages, those messages appear under a *different* Session — not mixed in with the previous one.
- The Session still shows which user it belongs to (existing per-user attribution is unchanged).
- With Langfuse not configured (no credentials), the chat works exactly as before — sending a message succeeds and nothing about the user-facing behaviour changes.

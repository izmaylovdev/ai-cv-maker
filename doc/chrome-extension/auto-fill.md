# Chrome Extension

A Manifest V3 extension that turns any job posting into a filled application: it
reads the job context off the page, asks the API for a tailored cover letter or
CV, and writes the result back into the page — or hands it to the user as a PDF.

**Code:** `apps/chrome-extension/`
**See also:** [web-client/cv-generation.md](../web-client/cv-generation.md) ·
[web-client/chat.md](../web-client/chat.md) ·
[ADR-0017](../adr/0017-google-signin-token-trust.md) (why the extension's Google flow is audience-checked)

---

## Surfaces

| Surface | What it is |
|---|---|
| **Side panel** | The main UI. Clicking the toolbar icon opens it for that tab. Hosts the `<ai-chat-widget>` bundle, a login view, and Settings / Hotkeys views. Chat is the default. |
| **`Alt+Shift+F`** | Quick fill — detect application fields on the page and write generated text into them. |
| **`Alt+Shift+D`** | Download an optimised CV for the current posting. |

Both shortcuts are configurable through Chrome's keyboard-shortcut settings, and
both work without the panel being open.

---

## Tab-scoped activation

The extension has no window-global presence. There is no `side_panel.default_path`
and no `openPanelOnActionClick` — the panel is enabled per tab on demand via
`chrome.sidePanel.setOptions({ tabId, path, enabled: true })`. A tab where the
extension was never invoked shows no panel; returning to a tab that has one finds
its state intact. The signed-out fallbacks in both command handlers open the
panel on the current tab through the same helper.

`content.js` is likewise **not** injected declaratively — there is no
`content_scripts` block. It reaches a page only through `ensureContentScript()`
(`chrome.scripting.executeScript`, all frames), which every message-sending path
calls first. That is why both hotkeys work on pages that were already open before
the extension was invoked.

Permissions: `storage`, `activeTab`, `scripting`, `identity`, `webNavigation`,
`downloads`, `sidePanel`, and `host_permissions: <all_urls>`.

---

## Reading the page

**Field detection** is purely heuristic — no per-site code, so LinkedIn,
Greenhouse, Lever, Workday, and plain HTML forms all work the same way. The
content script scans `<textarea>` and `[contenteditable]` elements whose label,
placeholder, `name`, or `id` contains any of: `cover`, `letter`, `motivation`,
`why`, `introduce`, `tell us`, `about yourself`, `additional`.

**Job context** comes from the user's text selection first
(`window.getSelection()`). With no selection it falls back to heuristics: the
`<h1>`, the largest text block inside an element whose `id`/`class`/`aria-label`
contains `description`, `details`, `about`, or `role`, and `document.title` —
concatenated and truncated to 3,000 characters. Under 100 characters counts as no
job description, and the UI says so: *"Could not detect a job description. Select
the job text on the page and try again."*

**Writing back** dispatches `input` and `change` events after setting the value,
so React/Vue/Angular host pages register it. The extension makes no further DOM
changes — the user reviews and edits in place before submitting.

If no field is found, the flow says so rather than writing anywhere.

---

## Flows

**Quick fill (`Alt+Shift+F`).** For each detected field, `POST /api/cover-letter`
with the job description. No profile id is needed — the backend picks the best
matching profile itself.

**Optimised CV (`Alt+Shift+D`, or Settings).** A profile selector lists the user's
profiles with **Auto** first and selected by default, persisted in
`chrome.storage.local`. With Auto, the extension calls
`POST /api/cvs/generate-auto` with the job description; with a specific profile,
`POST /api/job-profiles/{id}/cvs`. Either response yields the profile's full name
and the new CV id, which the extension uses to fetch
`GET /api/job-profiles/{profileId}/cvs/{cvId}/pdf` and download
`[FullName]_[JobTitle]_CV.pdf` — job title being the first line of the extracted
context, trimmed to 50 filesystem-safe characters. Progress shows as a spinner in
the panel or a browser notification from the hotkey path.

**Side-panel chat.** On open — and on active-tab change while open — the panel
pulls the current page's job context and gives it to the chat. The user asks
questions about the posting; the assistant answers from that context plus their
profile summaries. Asking for a cover letter produces a draft **inside the
thread** with a "Use this" action; nothing reaches the page until the user
activates it, at which point the draft goes through the same insert path and the
chat confirms. This is the `fill`-type proposal on the chat contract.

---

## Authentication

The panel shows a login view when there is no token, or after a 401. Email and
password go to `POST /api/auth/login`. The JWT is stored in
`chrome.storage.local` under the same `TOKEN_KEY` constant exported by
`@applysy/auth`, and every API call carries `Authorization: Bearer <token>`.

**Google sign-in** uses `chrome.identity.getAuthToken` to obtain a Google *access
token*, then exchanges it at `POST /api/auth/google/token`. The server only
accepts tokens minted for our own OAuth clients — see
[ADR-0017](../adr/0017-google-signin-token-trust.md); a raw access token is not by
itself proof of intent to sign in to us. The auth method is persisted so the
refresh path knows what to do.

On a 401 with `authMethod = "google"`, the extension drops the cached Google
token, fetches a fresh one non-interactively, exchanges it, and retries the
original request once. If that fails (session expired, consent revoked) it clears
the stored token and method and shows the login view. Cancelling the Google flow
is silent — no error, the login view stays put.

---

## Generated text style

Cover-letter text — from both the auto-fill chain and the side-panel chat's
`fill` proposal — reads as a direct first-person application message, not a
formal letter: no salutation, no sign-off, no signature line, no date, postal
address, or "Subject:"/"Re:" lines. It opens straight into first-person content
about the candidate's fit.

It contains **no bracketed placeholders** (`[Hiring Manager]`, `[Company Name]`):
information the model does not have is omitted rather than templated. Facts are
never invented, and the user's global preferences from
[settings](../web-client/settings.md) override the default style.

The `cover_letter_with_prefs` eval carries a deterministic style check scoring the
absence of salutations, sign-offs, signature lines, and bracketed placeholders,
with a CI threshold.

---

## Building and installing

The extension is built from `apps/chrome-extension/` and loads unpacked for
development; the same output ships as a ZIP for the Chrome Web Store. The
`<ai-chat-widget>` bundle is copied into the extension's own assets — the panel
has no network dependency on the chat-ui dev server.

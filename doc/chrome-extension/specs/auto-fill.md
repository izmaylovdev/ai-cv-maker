# Chrome Extension — Specs

## 1. Job Application Auto-Fill (US-EXT-1)

### 1.1 Functional Requirements

| # | Requirement |
|---|-------------|
| F-EXT-1.1 | The extension must be installable as an unpacked Chrome extension from the `apps/chrome-extension/` directory and distributed as a ZIP for the Chrome Web Store. |
| F-EXT-1.2 | Pressing the hotkey `Alt+Shift+F` (configurable via Chrome's keyboard shortcut settings) on any tab triggers the auto-fill flow for that page. |
| F-EXT-1.3 | A content script scans the active page for candidate fields: `<textarea>` elements and `[contenteditable]` elements whose associated label, placeholder, `name`, or `id` attribute contains any of the keywords: `cover`, `letter`, `motivation`, `why`, `introduce`, `tell us`, `about yourself`, `additional`. |
| F-EXT-1.4 | For each detected field the extension calls `POST /api/cover-letter` with the job description and field context; no profile ID is required — the backend selects the best-matching profile automatically. |
| F-EXT-1.5 | The API returns generated text; the extension writes it into the field and dispatches `input` and `change` events so the host-page framework (React, Vue, Angular) registers the value. |
| F-EXT-1.6 | If zero fields are detected the extension displays a browser notification: "No application fields detected on this page." |
| F-EXT-1.7 | The user can review and edit generated text in-place before submitting the form; the extension makes no further DOM changes after insertion. |
| F-EXT-1.8 | The extension popup (toolbar icon click) shows: login state, a "Fill this page" button, and — after generation — the name of the profile the API selected. An optional profile override dropdown allows the user to force a specific profile and re-generate. |
| F-EXT-1.9 | On first install (or when no token is stored) the popup renders a login form that calls the existing `POST /api/auth/login` endpoint; on success the JWT is stored in `chrome.storage.local` under the same `TOKEN_KEY` constant from `@applysy/auth`. |
| F-EXT-1.10 | The extension sends `Authorization: Bearer <token>` on every API call; if the API returns 401 it clears the stored token and shows the login form. |
| F-EXT-1.11 | Job description context passed to the API is extracted from the page: the text of the nearest `<h1>`, any element whose text contains "job description" or "about the role", and `document.title` — truncated to 2 000 characters. |
| F-EXT-1.12 | The extension must function on LinkedIn, Greenhouse, Lever, Workday, and generic HTML forms without site-specific code (purely heuristic detection). |

### 1.2 Technical Specification

#### New app: `apps/chrome-extension/`

A plain TypeScript + Vite project (no framework in the content script; React in the popup).

```
apps/chrome-extension/
  manifest.json          — MV3 manifest
  src/
    background.ts        — service worker; handles hotkey command, relays messages to content script
    content.ts           — injected into every page; detects fields, calls background for generation
    popup/
      main.tsx           — React popup (login, profile picker, fill button)
      Popup.tsx
      LoginForm.tsx
      ProfilePicker.tsx
  vite.config.ts
  tsconfig.json
```

**Manifest V3 key sections:**

```json
{
  "manifest_version": 3,
  "permissions": ["storage", "notifications", "activeTab", "scripting"],
  "host_permissions": ["<all_urls>"],
  "commands": {
    "fill-fields": {
      "suggested_key": { "default": "Alt+Shift+F" },
      "description": "Fill application fields on this page"
    }
  },
  "background": { "service_worker": "background.js" },
  "action": { "default_popup": "popup.html" },
  "content_scripts": [
    { "matches": ["<all_urls>"], "js": ["content.js"] }
  ]
}
```

---

#### API — new endpoint in `cv-api`

`POST /api/cover-letter`

Request body:
```json
{
  "jobTitle": "string",
  "jobDescription": "string (max 2000 chars)",
  "fieldContext": "string (label / placeholder of the target field)",
  "profileIdOverride": "uuid | null"
}
```

`profileIdOverride` is optional. When `null`, the backend selects the best profile automatically.

Response 200:
```json
{
  "text": "string",
  "selectedProfileId": "uuid",
  "selectedProfileName": "string"
}
```

Error responses:
- `400`: missing required fields or job description is empty.
- `401`: invalid or missing JWT.
- `404`: `profileIdOverride` specified but not found or not owned by the requesting user.
- `422`: user has no profiles.

Lives in a new `CoverLetterController`. The handler fetches all profiles for the requesting user (or just the override profile), passes them all to `LlmService.GenerateCoverLetter`, which selects the best match and returns the cover letter + matched points.

---

#### gRPC — new method in `llm_service.proto`

```protobuf
rpc GenerateCoverLetter (CoverLetterRequest) returns (CoverLetterResponse);

message CoverLetterRequest {
  repeated Profile profiles = 1;   // all user profiles (or just the override)
  string job_title = 2;
  string job_description = 3;
  string field_context = 4;
}

message CoverLetterResponse {
  string text = 1;
  string selected_profile_id = 2;
}
```

Regenerate stubs after editing the proto:
```bash
npm run grpc:generate
```

---

#### LLM service — new chain

`apps/llm-service/app/chains/cover_letter_chain.py`

- Receives all user profiles and the job description.
- Step 1 — profile selection: LLM scores each profile against the job description (title, required skills, responsibilities) and picks the best match. If only one profile is passed (override), this step is skipped.
- Step 2 — cover letter generation: using the selected profile, LLM writes a cover letter that opens with the candidate's fit, demonstrates relevant experience, and closes with a call to action.
- Returns the cover letter text and the selected profile ID.

New handler in `apps/llm-service/app/grpc/servicer.py`:
```python
async def GenerateCoverLetter(self, request, context):
    text = await generate_cover_letter(request)
    return CoverLetterResponse(text=text)
```

---

#### Data model

No schema changes. The endpoint reads existing `Profile` data; no new tables required.

---

### 1.3 Out of scope (MVP)

- Per-site field-detection rules (site-specific overrides).
- Streaming the generated text character-by-character into the field.
- Filling multi-step / pagination wizard forms.
- Support for browsers other than Chrome (Firefox, Edge extension may follow).
- Storing or reviewing past generated cover letters.

---

## 2. Google Sign-In for Chrome Extension (US-EXT-2)

### 2.1 Functional Requirements

| # | Requirement |
|---|-------------|
| F-EXT-2.1 | The extension login screen must display a "Sign in with Google" button below the existing email/password form. |
| F-EXT-2.2 | Clicking the button must call `chrome.identity.launchWebAuthFlow` with Google's OAuth2 endpoint using `response_type=id_token`, the extension's `chrome.identity.getRedirectURL()` as the redirect URI, and the configured Google client ID. |
| F-EXT-2.3 | The extension must extract the `id_token` from the response URL's fragment and POST it to `POST /api/auth/google` as `{ "credential": "<id_token>" }`. |
| F-EXT-2.4 | On a successful response the JWT must be stored in `chrome.storage.local` under `TOKEN_KEY` and the popup must transition to the authenticated view. |
| F-EXT-2.5 | The auth method (`"google"` or `"password"`) must be persisted in `chrome.storage.local` under `AUTH_METHOD_KEY` so the refresh logic knows whether to attempt a silent Google re-auth. |
| F-EXT-2.6 | If the user cancels the Google flow (error message contains "cancelled" or no URL is returned), no error is shown — the popup stays on the login screen silently. |
| F-EXT-2.7 | If the flow fails for any other reason (network error, backend rejection), a human-readable error message must be shown in the popup. |
| F-EXT-2.8 | When any API call returns 401 and the stored auth method is `"google"`, the extension must attempt a silent token refresh: re-run `launchWebAuthFlow` with `interactive: false` to get a new ID token without prompting the user, exchange it for a new JWT, and retry the original request once. |
| F-EXT-2.9 | If the silent refresh fails (user session expired, consent revoked), the extension must clear the stored token and auth method and fall back to showing the login screen. |
| F-EXT-2.10 | `manifest.json` must declare the `"identity"` permission. |
| F-EXT-2.11 | Existing email/password login (F-EXT-1.9) must remain fully functional and unchanged. |

### 2.2 Technical Specification

#### Extension changes only — no backend changes required

The backend already implements `POST /api/auth/google`. No API or data-model changes are needed.

#### `manifest.json`

Add `"identity"` to the `permissions` array:
```json
"permissions": ["storage", "notifications", "activeTab", "scripting", "identity"]
```

#### `apps/chrome-extension/src/popup/api.ts`

New storage key: `AUTH_METHOD_KEY = "cv_auth_method"` — value is `"google"` or `"password"`.

New export `loginWithGoogle()`:
- Builds the OAuth2 URL with `response_type=id_token`, `scope=email profile openid`, a random `nonce`, and `redirect_uri` from `chrome.identity.getRedirectURL()`.
- Calls `chrome.identity.launchWebAuthFlow({ url, interactive: true })`.
- Parses `id_token` from the response URL fragment.
- POSTs to `/api/auth/google` and returns the JWT.
- Saves `AUTH_METHOD_KEY = "google"` to storage.

New export `refreshGoogleToken()`:
- Same flow as `loginWithGoogle` but with `interactive: false`.
- Returns the new JWT or throws if refresh fails.

Updated `request<T>()` helper:
- On 401, checks `AUTH_METHOD_KEY`. If `"google"`, calls `refreshGoogleToken()`, saves the new token, and retries the request once.
- If retry also fails 401 (or refresh throws), calls `clearToken()` + `clearAuthMethod()` and throws `"UNAUTHORIZED"`.

New export `clearAuthMethod()`: removes `AUTH_METHOD_KEY` from storage. Called alongside `clearToken()` on logout.

#### `apps/chrome-extension/src/popup/Popup.tsx`

- `handleLogout` calls `clearAuthMethod()` in addition to `clearToken()`.
- `LoginForm` renders a "Sign in with Google" button that calls `loginWithGoogle()`, stores the token, and transitions to the authenticated view. Cancellation (detected by error message) is swallowed silently.

#### Google Cloud Console setup (one-time, outside code)

The extension's OAuth redirect URI (`https://<extension-id>.chromiumapp.org/`) must be added as an **Authorised redirect URI** on the Web application OAuth 2.0 client in Google Cloud Console.

### 2.3 Out of scope

- `chrome.identity.getAuthToken` flow (returns an access token, not an ID token; incompatible with the backend validator).
- Showing the signed-in Google account picture/name in the popup header.

---

## 3. Download Job-Optimised CV (US-EXT-3)

### 3.1 Functional Requirements

| # | Requirement |
|---|-------------|
| F-EXT-3.1 | The extension popup must show a profile selector dropdown listing all profiles owned by the authenticated user, with an **"Auto"** option as the first item and the default selection. The selected value is persisted in `chrome.storage.local` under `SELECTED_PROFILE_KEY`. |
| F-EXT-3.2 | The popup must show a "Download Optimised CV" button. The button is disabled when no meaningful job description can be extracted from the current page (see F-EXT-3.4). |
| F-EXT-3.3 | Pressing `Alt+Shift+D` (configurable via Chrome keyboard shortcut settings) on any tab must trigger the download flow using the currently stored `SELECTED_PROFILE_KEY` value, without requiring the popup to be open. |
| F-EXT-3.4 | A content script must extract the job context from the active page: first from any user text selection (`window.getSelection()`); if no selection, from the page heuristically: `<h1>` text, the largest block of text within an element whose `id`, `class`, or `aria-label` contains `description`, `details`, `about`, or `role`, and `document.title` — concatenated and truncated to 3 000 characters. If the result is < 100 characters the job description is considered absent. |
| F-EXT-3.5 | When the job description is absent the popup must show: "Could not detect a job description. Select the job text on the page and try again." and the button must remain disabled. |
| F-EXT-3.6 | When the button is clicked (or the hotkey fires) and a specific profile is selected, the extension must call `POST /api/profiles/:id/generate` with the job description in `optimizationNotes`. When "Auto" is selected, the extension must call the new `POST /api/cvs/generate-auto` endpoint (see Technical Specification) which accepts the job description and returns the generated CV for the best-matched profile. |
| F-EXT-3.7 | The response from either endpoint must include the selected/used profile's `fullName` and the generated CV `id`, used to construct the download filename and fetch the PDF. |
| F-EXT-3.8 | While generation is in progress the popup must display a spinner and the label "Generating CV…". The hotkey flow must show a browser notification: "Generating your optimised CV…". |
| F-EXT-3.9 | Once generation completes the extension must call `GET /api/profiles/:id/generated-cvs/:cvId/pdf` and trigger a file download named `[FullName]_[JobTitle]_CV.pdf`, where `JobTitle` is the first line of the extracted job context (trimmed, max 50 chars, filesystem-safe). |
| F-EXT-3.10 | On success the popup must show "Download complete ✓" for 3 seconds, then return to the default state. The hotkey flow must show a browser notification: "CV downloaded." |
| F-EXT-3.11 | On any API error (non-2xx) the popup must show the error message returned by the API, or a generic "Something went wrong. Please try again." if none is available. |
| F-EXT-3.12 | The profiles dropdown must be populated on popup open via `GET /api/profiles`. If the call fails, the dropdown shows a single disabled option "Could not load profiles" and the download button is disabled. |

### 3.2 Technical Specification

#### Extension — `manifest.json`

Add `"downloads"` to the `permissions` array (needed for `chrome.downloads.download`):
```json
"permissions": ["storage", "notifications", "activeTab", "scripting", "identity", "downloads"]
```

Add the new command:
```json
"commands": {
  "fill-fields": { "suggested_key": { "default": "Alt+Shift+F" }, "description": "Fill application fields on this page" },
  "download-optimised-cv": { "suggested_key": { "default": "Alt+Shift+D" }, "description": "Download optimised CV for this job posting" }
}
```

#### Extension — new storage key

`SELECTED_PROFILE_KEY = "cv_selected_profile"` — value is a profile UUID or the string `"auto"`.

#### Extension — `apps/chrome-extension/src/content.ts`

New export `extractJobContext(): string`:
1. If `window.getSelection().toString().trim().length >= 100`, return the selection (truncated to 3 000 chars).
2. Otherwise scan the DOM: collect `document.title`, text of the first `<h1>`, and the `textContent` of all elements whose `id`, `class`, or `aria-label` contains `description|details|about|role` (case-insensitive), ordered by text length descending.
3. Concatenate, deduplicate whitespace, truncate to 3 000 chars.
4. Return the result; caller checks for length >= 100.

#### Extension — `apps/chrome-extension/src/background.ts`

Handle `"download-optimised-cv"` command:
1. Send `{ type: "GET_JOB_CONTEXT" }` message to the active tab's content script.
2. Retrieve `SELECTED_PROFILE_KEY` from `chrome.storage.local`.
3. Show notification "Generating your optimised CV…".
4. Call `downloadOptimisedCv(jobContext, profileId)` (shared helper, see below).
5. On success show notification "CV downloaded." On failure show "CV generation failed: \<message\>".

#### Extension — `apps/chrome-extension/src/popup/api.ts`

New exports:

`getProfiles(): Promise<Profile[]>` — `GET /api/profiles`.

`generateAndDownloadCv(jobContext: string, profileId: string | "auto"): Promise<void>`:
1. If `profileId === "auto"`: POST to `/api/cvs/generate-auto` with `{ jobDescription: jobContext }`.  
   Otherwise: POST to `/api/profiles/:id/generate` with `{ optimizationNotes: jobContext }`.
2. Receive `{ cvId, profileId, fullName }` in both cases.
3. GET `/api/profiles/:profileId/generated-cvs/:cvId/pdf` — receive blob.
4. Use `chrome.downloads.download({ url: blobUrl, filename })` to save.

#### Extension — `apps/chrome-extension/src/popup/Popup.tsx`

New UI elements (rendered in the authenticated view, above the existing "Fill this page" button):

```
[ Auto ▾ ]   ← ProfilePicker dropdown
[ Download Optimised CV ]   ← disabled when no job context
  "Could not detect a job description…"   ← shown when disabled
  ⟳ Generating CV…   ← shown during generation
  ✓ Download complete   ← shown for 3 s after success
```

`ProfilePicker` component (`apps/chrome-extension/src/popup/ProfilePicker.tsx`):
- On mount: calls `getProfiles()`, builds options `[{ id: "auto", name: "Auto" }, ...profiles]`.
- Reads current selection from `chrome.storage.local`; defaults to `"auto"`.
- On change: persists new value to `chrome.storage.local`.

On popup open the content script is queried for job context to set button enabled state.

#### API — new endpoint in `cv-api`

`POST /api/cvs/generate-auto`

Request body:
```json
{
  "jobDescription": "string (max 3000 chars)"
}
```

Response 200:
```json
{
  "cvId": "uuid",
  "profileId": "uuid",
  "fullName": "string"
}
```

Error responses:
- `400`: `jobDescription` missing or empty.
- `401`: invalid or missing JWT.
- `422`: authenticated user has no profiles.

The handler:
1. Fetches all profiles owned by the requesting user.
2. Calls the new `SelectBestProfile` gRPC method on the LLM service, passing all profiles and the job description.
3. Receives the selected `profileId` back.
4. Calls the existing `GenerateCV` gRPC method with the selected profile and the job description as optimization notes.
5. Persists a `GeneratedCV` record (same as the existing generate flow) and returns `cvId`, `profileId`, `fullName`.

Lives in a new `AutoGenerateController` (or added to the existing `GeneratedCvsController`).

The existing `POST /api/profiles/:id/generate` and `GET /api/profiles/:id/generated-cvs/:cvId/pdf` are reused unchanged for the specific-profile path and PDF download.

#### gRPC — new method in `llm_service.proto`

```protobuf
rpc SelectBestProfile (SelectBestProfileRequest) returns (SelectBestProfileResponse);

message SelectBestProfileRequest {
  repeated Profile profiles = 1;
  string job_description = 2;
}

message SelectBestProfileResponse {
  string profile_id = 1;
}
```

Regenerate stubs after editing the proto:
```bash
npm run grpc:generate
```

#### LLM service — new chain

`apps/llm-service/app/chains/profile_selector_chain.py`

- Receives all user profiles and a job description.
- Constructs a prompt asking the LLM to score each profile against the job description (required skills, seniority, domain) and return the ID of the best match.
- Returns `profile_id`.

New handler in `apps/llm-service/app/grpc/servicer.py`:
```python
async def SelectBestProfile(self, request, context):
    profile_id = await select_best_profile(request.profiles, request.job_description)
    return SelectBestProfileResponse(profile_id=profile_id)
```

#### Data model

No schema changes.

### 3.3 Out of scope (MVP)

- Server-side profile scoring / automatic best-profile selection (deferred; "Auto" uses most-recently-updated profile).
- Streaming PDF generation progress.
- Storing or reviewing extension-initiated CV generations separately from web-app generations.
- Support for non-Chrome browsers.

---

## 4. Side-Panel Chat with Accept-to-Fill (US-EXT-4)

### 4.1 Functional Requirements

| # | Requirement |
|---|-------------|
| F-EXT-4.1 | Clicking the extension toolbar icon opens a Chrome side panel. The action popup is removed (`action.default_popup` deleted from the manifest). |
| F-EXT-4.2 | The side panel hosts the existing `<ai-chat-widget>` (the `apps/chat-ui` IIFE bundle), bundled into the extension's own assets (no network dependency on the chat-ui dev server). |
| F-EXT-4.3 | On panel open (and on active-tab change while open), the panel pulls the current page's job context (`GET_PAGE_CONTEXT`/`GET_JOB_CONTEXT`, reused from `content.ts`) and provides it to the chat as conversation context. |
| F-EXT-4.4 | The user can ask free-text questions about the job posting; the assistant answers using the job context plus the user's profile summaries. |
| F-EXT-4.5 | When the user asks for a cover letter, the assistant returns a draft rendered **inside the chat thread**; nothing is written to the page automatically. |
| F-EXT-4.6 | A cover-letter draft is accompanied by a "Use this" action in the thread. Activating it sends the draft text to the page via the existing `INSERT_TEXT`/`insertText` path and the chat then confirms ("Filled the cover letter field."). |
| F-EXT-4.7 | If the user does not activate "Use this", nothing is written to the page. |
| F-EXT-4.8 | If no candidate field is detected on the page when "Use this" is activated, the chat shows a clear note ("Couldn't find a field to fill on this page.") and writes nothing. |
| F-EXT-4.9 | Authentication reuses the existing stored JWT and Google/email flows; when unauthenticated (or on 401) the panel shows the existing login UI (moved out of the popup) instead of the chat. |
| F-EXT-4.10 | The panel supports client-side navigation between views. **Chat** is the default view. **Settings** and **Hotkeys** views are scaffolded as routes; Settings hosts the existing optimised-CV profile picker (relocated from the popup), and Hotkeys is a placeholder for future shortcut configuration. |
| F-EXT-4.11 | The existing hotkey flows (`Alt+Shift+F` quick fill, `Alt+Shift+D` optimised-CV download) continue to work unchanged. |

### 4.2 Technical Specification

#### Extension — `manifest.json`

- Remove `action.default_popup`; keep `action` (icon + title) for the toolbar button.
- Add `"side_panel": { "default_path": "panel/index.html" }`.
- Add `"sidePanel"` to `permissions`.
- All other permissions/commands unchanged.

#### Extension — `apps/chrome-extension/src/background.ts`

- On install/startup: `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })` so the toolbar icon opens the panel.
- Add a message relay used by the panel (which has no direct page access):
  - `PANEL_GET_PAGE_CONTEXT` → resolves the active tab, `ensureContentScript`, queries `GET_PAGE_CONTEXT` across frames (reusing the existing frame-walk in the `fill-fields` handler), returns `{ jobTitle, jobDescription, fieldContext, tabId, frameId }`.
  - `PANEL_INSERT_TEXT { text, tabId, frameId }` → sends the existing `INSERT_TEXT` message to that tab/frame. **Reuses `content.ts` `insertText` unchanged.**
- Existing `fill-fields` / `download-optimised-cv` command handlers are unchanged.

#### Extension — new `apps/chrome-extension/src/panel/`

A React app (mirrors the popup's stack), built by Vite as a second HTML entry (`panel/index.html`).

```
src/panel/
  index.html
  main.tsx          — mounts <Panel/>
  Panel.tsx         — auth gate + router shell (view switch)
  routes.ts         — minimal hash/state router: "chat" | "settings" | "hotkeys"
  views/
    ChatView.tsx    — hosts <ai-chat-widget>, wires context in + accept out
    SettingsView.tsx— relocated ProfilePicker (optimised-CV profile selection)
    HotkeysView.tsx — placeholder (lists current Alt+Shift+F / +D, links to chrome://extensions/shortcuts)
```

- **Routing** is intentionally tiny (a `useState<Route>` + a small nav), not a router library — enough to add views later without re-architecting.
- **Auth:** `Panel.tsx` reuses `popup/api.ts` (`getToken`, login helpers). No token → render the existing login UI (extracted from `Popup.tsx` into a shared `LoginForm`).
- **Chat hosting:** `ChatView` loads the bundled `chat-widget.js`, renders `<ai-chat-widget auth-token api-base>`, and:
  - sets the new `jobContext` property (below) from `PANEL_GET_PAGE_CONTEXT` on mount and on `chrome.tabs.onActivated`/`onUpdated`;
  - listens for the widget's new `fill` event → sends `PANEL_INSERT_TEXT` → on success calls the widget's `addAssistantNote("Filled the cover letter field.")`, on missing field `addAssistantNote("Couldn't find a field to fill on this page.")`.

#### `apps/chat-ui` — additive widget changes

The widget today supports `document` (edit mode, auto-applied) and the `edit` event. Add a **separate, review-then-accept** path for fillable text so the auto-apply edit flow is untouched:

- New optional **`jobContext` property** `{ jobTitle, jobDescription, fieldContext }`. When set (and `document` is not), it is sent in the `POST /api/chat` body as `jobContext`. Mutually exclusive with `document`.
- The response `proposal` may have `type: "fill"` carrying `text`. For a `fill` proposal the widget does **not** auto-emit; instead it renders the assistant message with a **"Use this" button** beneath the draft.
- New **`fill` `CustomEvent`** (detail `{ text }`) dispatched when the user clicks "Use this".
- `addAssistantNote` (already present) reports the fill outcome.

`main.tsx` exposes `jobContext` as a property and re-renders on set, mirroring the existing `document` property handling.

#### API — `POST /api/chat` (additive)

Add optional `jobContext` to the request (mutually exclusive with `document`):

Request (job-chat mode):
```json
{
  "message": "Write a cover letter for this role",
  "history": [ … ],
  "jobContext": { "jobTitle": "…", "jobDescription": "…", "fieldContext": "cover letter" }
}
```

Response 200 (cover-letter draft):
```json
{
  "reply": "Here's a draft cover letter tailored to the role:",
  "proposal": { "type": "fill", "description": "Cover letter draft", "text": "Dear …" }
}
```

Response 200 (question): `{ "reply": "…", "proposal": null }`.

`ChatController` wiring (`Features/Chat/ChatController.cs`):
- `UserChatRequest` gains `JobContextDto? JobContext`.
- Branch order: `Document is not null` → existing edit path; **else if `JobContext is not null`** → new `JobChatAsync` (profile summaries + job context); else → existing global `UserChat`.
- `ChatProposalDto` gains a nullable `Text` (used for `type:"fill"`; `PatchJson` stays for `type:"edit"`).
- Errors reuse the existing US-AI-11 classified `{ code, message }` handlers and usage limits.

#### gRPC + llm-service

- `proto/llm_service.proto`: add a `JobChat` rpc (or extend `UserChat` with optional job-context + a `fill` proposal). New messages: `JobChatRequest { repeated ProfileSummary profiles; string job_title; string job_description; string field_context; repeated ChatMessage history; }` → `JobChatResponse { string reply; ChatProposal proposal; }`, where `ChatProposal` gains a `text` field. Regenerate with `npm run grpc:generate`.
- New chain `apps/llm-service/app/chains/job_chat_chain.py`: given profile summaries + job posting + history, answers questions and, on cover-letter intent, returns `{ reply, proposal: { type:"fill", text } }`. Cover-letter prompt logic reuses/adapts `cover_letter_chain.py`. Register the handler in `grpc/servicer.py`. Add `app/chains/test_job_chat_chain.py`.

#### Data model

No schema changes.

### 4.3 Out of scope (this iteration)

- Settings/Hotkeys view **content** beyond the relocated profile picker (Hotkeys is a stub linking to `chrome://extensions/shortcuts`; in-app rebinding is later).
- Streaming cover-letter generation into the thread.
- Click-to-target field selection / per-site field adapters (keeps the existing heuristic `findCandidateFields`).
- Filling fields other than the first detected candidate (`fieldIndex: 0`, unchanged).
- Persisting chat history across panel open/close.
- Firefox/Edge side-panel equivalents.

## 5. Application-Message Style for Generated Text (US-EXT-5)

### 5.1 Functional Requirements

| # | Requirement |
|---|-------------|
| F-EXT-5.1 | Text generated by the auto-fill flow (`GenerateCoverLetter` → `cover_letter_chain.py`) is a direct, first-person application message: no salutation line, no closing sign-off phrase, no standalone candidate-name signature line, no date/postal-address/"Subject:"/"Re:" lines. |
| F-EXT-5.2 | The generated text contains no bracketed placeholders (e.g. `[Hiring Manager]`, `[Company Name]`); information the model does not have is omitted rather than templated. |
| F-EXT-5.3 | The text opens directly with first-person content about the candidate's fit for the role (the "must open with the candidate's name greetings" rule is removed). |
| F-EXT-5.4 | Cover-letter drafts produced by the side-panel chat (`JobChat` → `job_chat_chain.py`, proposal `type:"fill"`) follow the same style constraints as F-EXT-5.1–5.3. |
| F-EXT-5.5 | Existing generation behaviour is preserved: best-profile selection and the `PROFILE_INDEX:`/`COVER_LETTER:` response contract in `cover_letter_chain.py`, fact-grounding (no invented facts), and `global_preferences` overriding the default style in both chains. |
| F-EXT-5.6 | The `cover_letter_with_prefs` eval gains a deterministic style check that scores each output on the absence of salutations, sign-offs, signature lines, and bracketed placeholders, with a CI threshold. |

### 5.2 Technical Specification

Prompt-and-tests change confined to `apps/llm-service`. No API, gRPC contract, data-model, or extension changes.

#### llm-service — prompts

`app/chains/cover_letter_chain.py` — rewrite `_SYSTEM_PROMPT`:
- Reframe the role: the model writes a short application message that will be pasted into a free-text field on a job-application website — explicitly *not* a letter or an email.
- Remove the "must open with the candidate's name greetings" rule.
- Add explicit style rules: no salutation; no sign-off or signature block; no date, address, subject, or "Re:" lines; no bracketed placeholders; open directly with first-person content about fit for the role.
- Keep unchanged: the two-step task (select profile, then write), relevance-only content rule, no-invented-facts rule, and the exact `PROFILE_INDEX:` / `COVER_LETTER:` output contract (parser `_parse_response` is untouched).
- The `global_preferences` prepend ("User preferences — these OVERRIDE all other instructions below") stays as is, so user preferences can still restore letter conventions if a user wants them.

`app/chains/job_chat_chain.py` — extend `_SYSTEM_PROMPT`:
- In the "write (or revise) a cover letter" branch, add the same style rules for the proposal `text` (direct first-person application message; no salutation/sign-off/signature/letterhead; no bracketed placeholders).
- JSON response schema and proposal shape unchanged.

#### llm-service — tests (pytest)

- `app/chains/test_cover_letter_chain.py`: following the existing prompt-content test pattern (`test_system_prompt_*`), add tests asserting the system prompt (a) no longer contains the name-greetings opening rule, (b) forbids salutations and sign-offs, (c) forbids bracketed placeholders, and (d) still contains the `PROFILE_INDEX:`/`COVER_LETTER:` contract (existing test).
- `app/chains/test_job_chat_chain.py`: add prompt-content tests asserting the fill-proposal style rules are present.

#### llm-service — evals

- `evals/evaluators.py`: new deterministic `ApplicationMessageStyleEvaluator` (no LLM judge) scoring binary sub-metrics per case: `style.no_salutation`, `style.no_signoff`, `style.no_placeholders` — regex-based (e.g. `^\s*(dear|to whom|hi|hello)\b`, closing-phrase list `sincerely|best regards|kind regards|yours faithfully|yours truly|warm regards` on a trailing line, `\[[^\]]+\]`).
- `evals/run_evals.py`: add the evaluator to the `cover_letter_with_prefs` op; thresholds `style.no_salutation: 1.0`, `style.no_signoff: 1.0`, `style.no_placeholders: 1.0`.
- `evals/fixtures/cover_letter_with_prefs_cases.jsonl`: existing cases keep working (their prefs are about length/tone, not letter format); add one case whose `global_preferences` explicitly requests a formal letter with salutation and sign-off, to prove the override still wins — excluded from the three style metrics above (marked via case metadata).

#### Data model / API / gRPC

No changes.

### 5.3 Out of scope (MVP)

- Post-processing/stripping of letter artifacts in code (`_parse_response` stays a pure parser; style is enforced by prompt + evals).
- Extension-side or UI changes (the extension pastes whatever text the API returns, unchanged).
- Per-field style variants driven by `field_context` (e.g. shorter text for "why us" fields) — the field context keeps its current advisory role.
- Localisation of style rules for non-English postings.

## 6. Tab-Scoped Extension Activation (US-EXT-7)

### 6.1 Functional Requirements

| # | Requirement |
|---|-------------|
| F-EXT-7.1 | The side panel has no window-global default: `side_panel.default_path` is removed from `manifest.json` and `setPanelBehavior({ openPanelOnActionClick: true })` is removed from the background script. The panel is enabled per tab, on demand, via `chrome.sidePanel.setOptions({ tabId, path: "panel/index.html", enabled: true })`. |
| F-EXT-7.2 | Clicking the toolbar icon (`chrome.action.onClicked`) enables and opens the side panel for the clicked tab only. Tabs where the extension was not invoked show no panel; a tab-scoped panel reappears (state intact) when the user returns to its tab. |
| F-EXT-7.3 | The two signed-out fallbacks in the command handlers (`fill-fields`, `download-optimised-cv`) open the panel on the current tab by calling the same per-tab enable-then-open helper. |
| F-EXT-7.4 | `content.js` is no longer injected declaratively: the `content_scripts` block is removed from `manifest.json`. The script reaches a page only through the existing `ensureContentScript()` programmatic injection (`chrome.scripting.executeScript`, all frames), which every message-sending path already calls first. |
| F-EXT-7.5 | Both hotkey flows and the side-panel relay (`PANEL_GET_PAGE_CONTEXT` / `PANEL_INSERT_TEXT`) work unchanged on pages loaded before the extension was invoked, because injection happens on demand at invocation time. |
| F-EXT-7.6 | Manifest permissions are unchanged (`activeTab`, `scripting`, `sidePanel`, `host_permissions: <all_urls>` all stay). |

### 6.2 Technical Specification

Extension-only change: `apps/chrome-extension/manifest.json` and `apps/chrome-extension/src/background.ts`. No API, gRPC, data-model, or Angular changes.

#### manifest.json

- Delete the `content_scripts` array.
- Delete the `side_panel` key (`default_path` was its only member). The `"sidePanel"` entry in `permissions` stays — it is what enables the API; the panel path moves to code.
- Everything else (permissions, host_permissions, commands, oauth2, background) unchanged.

#### background.ts

- Remove both `chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true })` calls (top-of-file and inside `onInstalled`).
- Add a helper and wire the toolbar icon to it:

```ts
const PANEL_PATH = "panel/index.html";

async function openPanelForTab(tabId: number): Promise<void> {
  try {
    await chrome.sidePanel.setOptions({ tabId, path: PANEL_PATH, enabled: true });
    await chrome.sidePanel.open({ tabId });
  } catch { /* sidePanel API unavailable */ }
}

chrome.action.onClicked.addListener((tab) => {
  if (tab.id !== undefined) void openPanelForTab(tab.id);
});
```

  `chrome.sidePanel.open()` must run in response to a user gesture; both `action.onClicked` and `commands.onCommand` qualify, and the gesture survives the awaited `setOptions` call (extension-API promise chains keep the gesture context).
- Replace the two signed-out fallbacks `chrome.sidePanel?.open({ tabId }).catch(() => {})` in the command handlers with `openPanelForTab(tabId)`.
- `ensureContentScript()`, the relay listeners, and all message flows are untouched.

#### Behaviour notes

- A panel enabled via `setOptions({ tabId })` is tab-bound: Chrome hides it when the user switches tabs and restores it (same document, state intact) when they return. Closing the tab discards it.
- Independent tabs each get their own panel instance when invoked; there is no shared window-level panel any more.
- The tab-scoped panel persists across in-tab navigations (the `enabled` option is keyed to the tab, not the URL).

#### Tests (vitest, `apps/chrome-extension`)

- New `src/background.test.ts` (mocked `chrome` global, same style as `content.test.ts`):
  - loading the module registers `chrome.action.onClicked` and never calls `setPanelBehavior`;
  - firing the `onClicked` handler with a tab calls `sidePanel.setOptions({ tabId, path: "panel/index.html", enabled: true })` then `sidePanel.open({ tabId })`;
  - firing the `fill-fields` / `download-optimised-cv` command with no stored token calls the same setOptions+open pair for the active tab.
- New `src/manifest.test.ts`: parse `manifest.json` and assert `content_scripts` is absent, `side_panel` is absent, and `permissions` still contains `sidePanel`, `activeTab`, `scripting`.

#### Verification (real browser)

Playwright launches a persistent Chromium context with `--load-extension` pointing at `dist/apps/chrome-extension`; per-tab panel state is asserted via the extension service worker (`chrome.sidePanel.getOptions({ tabId })`) and content-script absence via `chrome.tabs.sendMessage` PING failing on an un-invoked tab.

### 6.3 Out of scope (MVP)

- Tightening `host_permissions` from `<all_urls>` (still needed so the side-panel relay can inject into cross-origin frames without a fresh `activeTab` grant).
- Restricting activation to known job-board domains.
- A UI affordance to close/disable the panel for a tab from within the panel.
- Migrating existing users' expectations (no onboarding note about the panel no longer following tabs).

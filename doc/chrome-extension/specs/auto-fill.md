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
| F-EXT-1.9 | On first install (or when no token is stored) the popup renders a login form that calls the existing `POST /api/auth/login` endpoint; on success the JWT is stored in `chrome.storage.local` under the same `TOKEN_KEY` constant from `@ai-cv-maker/auth`. |
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

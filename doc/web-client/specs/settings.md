# Settings — Specs

## 1. Settings Page (US-SETTINGS-1)

### 1.1 Functional Requirements

| # | Requirement |
|---|-------------|
| F-SETTINGS-1.1 | A "Settings" link appears in the main app navigation. |
| F-SETTINGS-1.2 | The Settings page contains a "Global Preferences" section with a labelled textarea (placeholder: "Add tone, formatting, or rules."). |
| F-SETTINGS-1.3 | A "Save" button persists the textarea value via `PUT /api/settings/preferences`. |
| F-SETTINGS-1.4 | On page load, the current preferences value is fetched via `GET /api/settings/preferences` and pre-filled in the textarea. |
| F-SETTINGS-1.5 | A success toast notification is shown after a successful save. |

### 1.2 Technical Specification

#### API

**`GET /api/settings/preferences`** — returns current user's preferences.

Response 200:
```json
{ "globalPreferences": "string | null" }
```

**`PUT /api/settings/preferences`** — saves current user's preferences.

Request body:
```json
{ "globalPreferences": "string" }
```

Response 200:
```json
{ "globalPreferences": "string" }
```

Errors: 401 if unauthenticated.

#### Data model

Add `GlobalPreferences string?` column to the `Users` table (nullable). EF Core migration required.

#### Angular

- New route `/settings` → `SettingsComponent` at `features/settings/settings.component.ts`
- New service `SettingsService` at `core/services/settings.service.ts` (GET + PUT via `HttpClient`)
- "Settings" nav link added to the shell/nav component

## 2. Apply Global Preferences to AI Generation (US-SETTINGS-2)

### 2.1 Functional Requirements

| # | Requirement |
|---|-------------|
| F-SETTINGS-2.1 | When the user has global preferences saved, they are passed to the LLM on every CV generation request. |
| F-SETTINGS-2.2 | When the user has global preferences saved, they are passed to the LLM on every cover letter generation request. |
| F-SETTINGS-2.3 | If `GlobalPreferences` is null or empty, all generation behaviour is unchanged. |

### 2.2 Technical Specification

#### gRPC proto changes

Add an optional `global_preferences` field to `GenerateRequest`, `OptimizeRequest`, and `CoverLetterRequest` in `proto/llm_service.proto`:

```proto
message GenerateRequest    { … string global_preferences = 3; }
message OptimizeRequest    { … string global_preferences = 3; }
message CoverLetterRequest { … string global_preferences = 6; }
```

Regenerate with `npm run grpc:generate`.

#### ASP.NET Core (`cv-api`)

- `LlmGenerateRequest`, `LlmOptimizeRequest`, `LlmCoverLetterRequest` — add `string? GlobalPreferences` field.
- `CoverLetterService.GenerateAsync` — load the `User` and pass `user.GlobalPreferences` into `LlmCoverLetterRequest`.
- CV generation service — same: load user, pass `GlobalPreferences` into `LlmGenerateRequest` / `LlmOptimizeRequest`.
- `LlmService.cs` (gRPC client adapter) — map the new field onto the proto message before sending.

#### LLM service (`llm-service`)

- `CoverLetterRequest` dataclass — add `global_preferences: str = ""`.
- `cv_chain.py` `GenerateRequest` / `OptimizeRequest` — add `global_preferences: str = ""`.
- In each chain function, if `global_preferences` is non-empty, append it to the system prompt:
  ```
  \n\nUser preferences (apply to all output):\n{global_preferences}
  ```
- `grpc/servicer.py` — map the new proto field through to the dataclass on all three RPCs.

## 3. Manage Preferences via AI Chat (US-SETTINGS-3)

### 3.1 Functional Requirements

| # | Requirement |
|---|-------------|
| F-SETTINGS-3.1 | The AI assistant can fetch and display the user's current global preferences when asked. |
| F-SETTINGS-3.2 | The AI assistant can update the user's global preferences when instructed. |
| F-SETTINGS-3.3 | Updated preferences are persisted immediately and visible on the Settings page without a page reload. |
| F-SETTINGS-3.4 | The assistant confirms the update in its reply. |

### 3.2 Technical Specification

#### Approach — tool use inside cv-api (no LLM service changes)

Tool calls are handled entirely in `cv-api`, not in the LLM service. The `ChatController` performs a multi-turn loop:

1. Send the user message + available tools to the LLM via Anthropic SDK directly (bypassing gRPC for tool-use turns).
2. If the model returns a `tool_use` block (`get_preferences` or `update_preferences`), cv-api executes the tool against the DB, appends the `tool_result`, and calls the LLM again.
3. When the model returns a plain text reply, return it to the client.

This avoids any proto or gRPC changes — tool execution stays in the .NET layer.

#### Tools exposed to the LLM

| Tool | Description |
|---|---|
| `get_preferences` | Returns the user's current `globalPreferences` string. No input. |
| `update_preferences` | Replaces `globalPreferences` with a new value. Input: `{ "preferences": string }` |

#### API changes

`POST /api/chat` — no request/response schema change. The tool loop is internal.

#### ASP.NET Core (`cv-api`)

- `ChatController` — load `User.GlobalPreferences` at request start; call Anthropic SDK with tool definitions; implement a `tool_use` dispatch loop; persist updates via `AppDbContext`.
- New `IChatService` / `ChatService` in `Features/Chat/` — encapsulates the tool-use loop, keeps the controller thin.
- Anthropic SDK (`Anthropic.SDK` NuGet) — already used by llm-service; add to cv-api for direct tool-use calls.

#### LLM service / proto

No changes required.

#### Angular

No changes required.

## 4. Usage Page in Navigation (US-SETTINGS-4)

### 4.1 Functional Requirements

| # | Requirement |
|---|-------------|
| F-SETTINGS-4.1 | A "Usage" nav link is added to the sidebar for authenticated users, routing to `/usage`. |
| F-SETTINGS-4.2 | The `/usage` route is protected by `authGuard` and loads `UsageComponent`. |
| F-SETTINGS-4.3 | The existing `UsageComponent` and `UsageService` are moved from `features/settings/` to `features/usage/`. |
| F-SETTINGS-4.4 | The `/settings/usage` route is removed; `/usage` replaces it. |

### 4.2 Technical Specification

#### Angular

- Move `usage.component.ts` and `usage.service.ts` from `features/settings/` to `features/usage/`
- Add route `/usage` in `app.routes.ts` (replace `/settings/usage`)
- Add `<a routerLink="/usage">` nav link to `app.html` sidebar

#### Out of scope (MVP)

- Usage breakdown by model or operation
- Usage quotas or limits UI

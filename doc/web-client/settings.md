# Settings

One page, one setting: free-text **global preferences** that ride along with every
AI generation, so a user states their tone and formatting rules once instead of
repeating them in each request.

**Code:** `apps/ui-angular/src/app/features/settings/`, `apps/cv-api/Features/Settings/`

---

## Global preferences

`/settings` shows a labelled textarea ("Add tone, formatting, or rules.")
pre-filled with the saved value, and a Save button that persists it and shows a
success toast.

Whatever the user writes is appended to the system prompt of the generation
chains as:

```
User preferences (apply to all output):
<the user's text>
```

It applies to **CV generation** and **cover letter generation**. When the value is
null or empty, nothing is appended and generation behaves exactly as if the
feature did not exist.

The text travels to llm-service as the `global_preferences` field on
`GenerateRequest` and `CoverLetterRequest`
(`proto/llm_service.proto` is the contract source of truth).

---

## API

| Endpoint | Purpose |
|---|---|
| `GET /api/settings/preferences` | `{ globalPreferences: string \| null }` |
| `PUT /api/settings/preferences` | Body `{ globalPreferences }` → the saved value |

Both require a JWT and operate only on the caller's own row. The value is stored
as the nullable `Users.GlobalPreferences` column.

---

## Not implemented

Reading or changing preferences through the AI chat was specified (tool calls
`get_preferences` / `update_preferences` handled inside cv-api) but never built —
there is no tool-use loop in `ChatController` and no Anthropic SDK dependency in
cv-api. Per-profile preference overrides do not exist either; the setting is
global to the user.

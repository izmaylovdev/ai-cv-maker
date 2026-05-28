# AI CV Maker — Specs

This folder contains functional and technical specifications derived from the user stories in [`../user-stories/`](../user-stories/).

Each spec covers: functional requirements (what the feature must do), API contracts, data models, error handling, and out-of-scope items for MVP.

## Spec Files

| File | Feature Area | Source Stories |
|------|-------------|----------------|
| [authentication.md](authentication.md) | Registration, login, session management | US-AUTH-1 – US-AUTH-5 |
| [job-profiles.md](job-profiles.md) | Creating and managing job profiles | US-PROF-1 – US-PROF-5 |
| [profile-editing.md](profile-editing.md) | Profile editor, live preview, save | US-EDIT-1 – US-EDIT-7 |
| [ai-enhancement.md](ai-enhancement.md) | Field enhancement & full profile optimization | US-AI-1 – US-AI-3 |
| [cv-generation.md](cv-generation.md) | AI CV generation & PDF export | US-CV-1 – US-CV-6 |
| [chat.md](chat.md) | Conversational AI career assistant | US-AI-4 |

## Conventions

- **F-{AREA}-{N}** — functional requirement ID (e.g., `F-AUTH-1.1`)
- "Out of Scope (MVP)" sections list explicitly deferred features so they are not inadvertently implemented
- API response shapes are illustrative; the authoritative contract lives in the proto/OpenAPI definitions once generated

# Spec: Job Profiles

**Source user stories:** US-PROF-1 – US-PROF-8  
**Feature area:** Creating and managing multiple job profiles  
**Status:** Draft

---

## 1. Overview

A **Job Profile** is the central data entity of the application. Users may create multiple profiles — one per target role or industry — each storing personal info, work experience, education, and skills independently. Profiles serve as the source of truth for CV generation.

---

## 2. Functional Requirements

### 2.1 View All Profiles (US-PROF-1)

| # | Requirement |
|---|-------------|
| F-PROF-1.1 | The profiles dashboard (`/profiles`) lists all profiles belonging to the authenticated user. |
| F-PROF-1.2 | Each profile card displays: profile name, full name, and professional title. |
| F-PROF-1.3 | When no profiles exist, an empty state is shown with a CTA to create the first profile. |

### 2.2 Create a Blank Profile (US-PROF-2)

| # | Requirement |
|---|-------------|
| F-PROF-2.1 | The user can create a new blank profile by providing a profile name (free text). |
| F-PROF-2.2 | If no name is entered, it defaults to `"My Profile"`. |
| F-PROF-2.3 | After creation, the user is immediately redirected to the profile editor at `/profiles/:id`. |

### 2.3 Bootstrap from Existing CV (US-PROF-3)

| # | Requirement |
|---|-------------|
| F-PROF-3.1 | The profile creation flow offers a "Upload existing CV" option accepting `.pdf` and `.txt` files. |
| F-PROF-3.2 | The AI extracts: full name, professional title, work experience entries (company, role, dates, description), education entries, and skills. |
| F-PROF-3.3 | Extracted data pre-populates the new profile; the user reviews and edits before saving. |
| F-PROF-3.4 | Partial extraction (e.g., skills not found) still creates the profile; the user is notified which fields could not be extracted. |
| F-PROF-3.5 | Maximum file size: **5 MB**. Files exceeding this are rejected with a clear error. |

### 2.4 Delete a Profile (US-PROF-4)

| # | Requirement |
|---|-------------|
| F-PROF-4.1 | A delete action is available on each profile card (e.g., a kebab menu or trash icon). |
| F-PROF-4.2 | The user must confirm deletion via a modal dialog before it proceeds. |
| F-PROF-4.3 | Deleting a profile cascades to delete all generated CVs associated with it. |
| F-PROF-4.4 | After deletion the dashboard refreshes and the deleted card is removed. |

### 2.5 Navigate Between Profiles (US-PROF-5)

| # | Requirement |
|---|-------------|
| F-PROF-5.1 | A "← Back to profiles" link is visible in the profile editor header. |
| F-PROF-5.2 | Clicking it returns the user to `/profiles` with all cards in their current state. |

### 2.6 Default CV Template (US-PROF-6)

| # | Requirement |
|---|-------------|
| F-PROF-6.1 | Creating a blank profile (`POST /api/profiles`) seeds its document with a default CV template instead of an empty body. |
| F-PROF-6.2 | The template body contains four titled sections in order: **Professional Summary**, **Work Experience**, **Education**, **Skills**. |
| F-PROF-6.3 | Scaffolding per section: Summary → one empty paragraph; Work Experience → a timeline with one empty entry; Education → a timeline with one empty entry; Skills → an empty chips group. |
| F-PROF-6.4 | The header (name, title, email, phone, location) and every content field start empty — the template carries structure only, no placeholder/fake data. |
| F-PROF-6.5 | The seeded document passes `ProfileDocumentSchema.Validate` (block-tree schema, ADR-0014 §13). |
| F-PROF-6.6 | The template only applies to the blank-create path; bootstrap-from-CV (US-PROF-3) continues to seed from extracted data, not the template. |
| F-PROF-6.7 | Empty template nodes render as editable scaffolding in the profile editor; the PDF walk skips empty nodes (graceful degradation), so an untouched new profile still yields a near-empty PDF by design. |

### 2.7 Rename a Profile (US-PROF-7)

| # | Requirement |
|---|-------------|
| F-PROF-7.1 | Each profile row on the dashboard has a visible rename action (pencil icon) that turns the row's name into an inline text input. |
| F-PROF-7.2 | Enter or clicking away (blur) saves the new name; Escape cancels and restores the previous name. Activating the rename action never navigates into the profile. |
| F-PROF-7.3 | The profile name in the editor page header (`/job-profiles/:id`) is editable in place with the same Enter / blur / Escape semantics; a confirmed change is saved immediately (independent of the document Save button). |
| F-PROF-7.4 | Rename persists via a dedicated name-only API call (`PATCH /api/job-profiles/:id`); the profile's document is never sent or modified by a rename. |
| F-PROF-7.5 | A blank or whitespace-only name is not saved: the edit is cancelled client-side and the previous name is restored; the API rejects blank names with 400. |
| F-PROF-7.6 | The saved name survives a full page reload and is consistent on the dashboard list and the editor header. |

### 2.8 Meaningful Name on CV Import (US-PROF-8)

| # | Requirement |
|---|-------------|
| F-PROF-8.1 | The LLM extraction call (`ExtractProfile`) additionally returns a suggested profile name — a short role-oriented label (≤ 100 chars) — produced in the same LLM call as the document extraction (no extra round-trip). |
| F-PROF-8.2 | Name derivation preference order: the CV's stated professional title → a title inferred from the most recent role → the candidate's full name. If none is derivable, the suggested name is empty. |
| F-PROF-8.3 | `POST /api/job-profiles/:id/extract` returns the suggested name in its `name` field when the LLM produced one; otherwise it returns the profile's current name (existing behaviour). |
| F-PROF-8.4 | In the create-with-CV flow, a user-typed name always wins; only when the name field was left blank is the suggested name applied to the profile. |
| F-PROF-8.5 | If extraction fails or yields no usable name, the profile keeps the `"My Profile"` default (existing behaviour). |
| F-PROF-8.6 | The create form's existing hint "(optional — will be set from CV if blank)" now reflects real behaviour — wording stays as is. |

---

## 3. Technical Specification

### 3.1 API Endpoints

#### `GET /api/profiles`

Returns all profiles for the authenticated user.

**Response 200:**
```json
[
  {
    "id": "uuid",
    "name": "Senior Frontend Role",
    "fullName": "Jane Doe",
    "title": "Senior React Developer",
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-02T00:00:00Z"
  }
]
```

---

#### `POST /api/profiles`

Creates a new blank profile.

**Request body:**
```json
{ "name": "My Profile" }
```

**Response 201:**
```json
{ "id": "uuid", "name": "My Profile", ... }
```

---

#### `POST /api/profiles/bootstrap`

Creates a profile by extracting data from an uploaded CV file.

**Request:** `multipart/form-data`

| Field | Type | Notes |
|-------|------|-------|
| `file` | file | `.pdf` or `.txt`, max 5 MB |
| `name` | string | Optional profile name |

**Response 201:**
```json
{
  "id": "uuid",
  "name": "...",
  "extractionWarnings": ["Skills could not be extracted"],
  "profile": { ... }
}
```

**Response 422:** File too large or unsupported format.

---

#### `DELETE /api/profiles/:id`

Deletes the profile and all its generated CVs.

**Response 204:** No content.  
**Response 404:** Profile not found or not owned by user.

---

### 3.2 CV Upload & Extraction Pipeline

```
Client → POST /api/profiles/bootstrap (multipart)
       → Server validates file type & size
       → Extract text:
           PDF  → pdf-parse (or pdfjs-dist)
           TXT  → read as UTF-8
       → Send extracted text to AI with structured extraction prompt
       → Parse AI response into ProfileData shape
       → Persist profile (with warnings if partial)
       → Return 201 with profile + warnings
```

AI extraction prompt must instruct the model to output structured JSON matching `ProfileData` (see §3.4). The server validates the JSON before persisting.

### 3.3 Cascade Delete

`DELETE /api/profiles/:id` must:
1. Verify ownership (`userId` match).
2. Delete all `GeneratedCV` records with `profileId = id`.
3. Delete the `Profile` record.

All three steps should run in a single database transaction.

### 3.4 Data Model

> **Superseded (ADR-0013).** The structured `Profile` shape below — `fullName`/
> `title`/`summary`/contacts plus `workExperience`/`education`/`skills`/
> `sectionOrder` — has been **retired**. A profile now stores a canonical
> `ProfileDocument { header, body }` (a flat title-anchored `BlockNode` tree,
> ADR-0013 with the body amended by ADR-0014; cv-api persists it as a jsonb
> `document` column; `GET/PUT /api/job-profiles/:id` speak `{ id, name,
> document }`). See `ARCHITECTURE.md` and ADR-0013/0014; the model below is kept
> for history only.

```ts
interface Profile {
  id: string;                    // UUID v4
  userId: string;                // FK → User.id
  name: string;                  // display name, max 100 chars
  fullName: string;
  title: string;
  summary?: string;
  location?: string;
  email?: string;
  phone?: string;
  workExperience: WorkEntry[];
  education: EducationEntry[];
  skills: string[];              // ordered array
  sectionOrder: SectionKey[];    // e.g. ["experience","education","skills"]
  createdAt: Date;
  updatedAt: Date;
}

interface WorkEntry {
  id: string;
  company: string;
  role: string;
  startDate: string;             // ISO 8601 date (YYYY-MM)
  endDate?: string;              // null = current role
  description: string;
}

interface EducationEntry {
  id: string;
  institution: string;
  degree: string;
  field: string;
  startYear: number;
  endYear?: number;              // null = ongoing
}

type SectionKey = "experience" | "education" | "skills";
```

### 3.5 Validation Rules

| Field | Rule |
|-------|------|
| `name` | Required, 1–100 characters |
| File type | `.pdf` or `.txt` only |
| File size | ≤ 5 MB |
| `fullName` | Required when saving a profile (not on initial creation) |
| `title` | Required when saving a profile |

---

### 3.6 Default Profile Template (US-PROF-6)

New factory on the domain model:

```csharp
// ProfileDocument.cs
public static ProfileDocument DefaultTemplate();
```

Returns a `ProfileDocument` with an empty `ProfileHeader` and a `root` body whose
children are (each node assigned a fresh id):

| Order | Node | Attrs / children |
|-------|------|------------------|
| 1 | `title` | `text: "Professional Summary"` |
| 2 | `paragraph` | no children (empty) |
| 3 | `title` | `text: "Work Experience"` |
| 4 | `timeline` | one `entry` with `title: ""`, `dates: ""`, one empty `paragraph` |
| 5 | `title` | `text: "Education"` |
| 6 | `timeline` | one `entry` with `title: ""`, `dates: ""`, one empty `paragraph` |
| 7 | `title` | `text: "Skills"` |
| 8 | `chips` | no children (empty) |

**Wiring:** `JobProfileService.CreateAsync` seeds `ProfileDocument.DefaultTemplate()`
instead of `ProfileDocument.Empty()`. `Empty()` is retained (used by
`UpdateProfileAsync`'s null-guard). No API contract change — `POST /api/profiles`
request/response shapes are unchanged; only the seeded body differs. No schema or
EF migration change: the document lives in the existing jsonb column.

**Angular:** no component or route change — the editor loads the document via
`GET /api/profiles/:id` and renders whatever block tree it receives.

---

### 3.7 Rename a Profile (US-PROF-7)

#### API

`PATCH /api/job-profiles/{id}`

Renames the profile without touching its document. JWT required.

Request body:
```json
{ "name": "Senior Backend Engineer" }
```

Response 200:
```json
{ "id": "uuid", "name": "Senior Backend Engineer", "fullName": "…", "title": "…" }
```
(`JobProfileListItemDto` — same shape as the list/create endpoints.)

Error responses: 400 — name missing, blank, or > 100 chars after trim; 404 — profile not found or not owned by the caller.

**Service:** new `RenameAsync(Guid id, Guid userId, string name)` on `IJobProfileService` / `JobProfileService`. Trims the name, updates `Profile.Name` only. No EF migration (column exists).

> Why a new verb: `PUT /api/job-profiles/{id}` replaces the document (`request.Document ?? Empty()`), so a name-only PUT would wipe the document. PATCH isolates rename semantics (F-PROF-7.4).

#### Angular

- `ProfileService.renameProfile(id, name)` → `PATCH`, returns `JobProfileListItem`.
- `JobProfilesComponent` (dashboard): per-row pencil button (`event.stopPropagation()`); row enters edit mode (`editingId` signal + name input). Enter/blur → save if trimmed name non-empty and changed, else cancel; Escape → cancel. On success, update the row in the `profiles` signal.
- `ProfileComponent` (editor header): the `<h1>` name becomes click-to-edit (plus a pencil affordance). Same key semantics; on confirm calls `renameProfile` immediately and updates the `profileName` signal. The existing document Save flow (PUT with `name: profileName()`) is unchanged and stays consistent because the signal holds the new name.

### 3.8 Meaningful Name on CV Import (US-PROF-8)

#### gRPC (proto change — contract source of truth)

`proto/llm_service.proto`:

```proto
message ExtractProfileResponse {
  ProfileDocumentProto document = 1;
  UsageMetadata usage = 2;
  string profile_name = 3;   // US-PROF-8: LLM-suggested short role label ("" if none)
}
```

Regenerate stubs:
```bash
npm run grpc:generate
```

#### llm-service

- `_EXTRACT_SYSTEM_PROMPT` (`app/chains/cv_chain.py`): the model now returns
  `{ "profileName": str, "document": ProfileDocument }` — one JSON object, same single call.
  Prompt rules for `profileName`: short role-oriented label (e.g. "Senior Backend Engineer"),
  ≤ 100 chars; prefer the CV's stated professional title, else infer from the most recent
  role, else use the candidate's full name; never invent a role not supported by the CV.
- `ExtractResponse` (`app/schemas.py`) gains `profile_name: str = ""`.
- Parsing (both Anthropic-direct and LangChain paths): parse the wrapper object; if the model
  returned a bare `ProfileDocument` (legacy shape), fall back to parsing it as before with
  `profile_name=""` — extraction must never fail because of the name field.
- Code-side fallback when the model's `profileName` is blank: `header.title`, then
  `header.fullName`, else `""`.
- `servicer.ExtractProfile` maps `result.profile_name` → `profile_name` on the proto response.

#### cv-api

- `LlmExtractResponse` gains `string ProfileName` (`""` when absent); `LlmService.ExtractAsync` maps it from the proto reply.
- `JobProfileService.ExtractAsync`: returns `new UpdateProfileRequest(suggestedName, document)` where `suggestedName` = trimmed LLM name capped at 100 chars if non-blank, else `profile.Name` (F-PROF-8.3). No controller change — the `name` field already exists on the response DTO.

#### Angular

`JobProfilesComponent.create()`: remember whether the user typed a name (`typedName = this.newName.trim()`). After extraction, the follow-up `updateProfile` uses `typedName || extracted.name || 'My Profile'` — typed name wins, LLM suggestion fills the blank, placeholder is last resort (F-PROF-8.4/8.5). Extraction-failure path is unchanged (profile keeps its creation name).

#### Out of scope (MVP)

- Renaming from within the AI chat / profile-builder web component.
- Re-suggesting a name when a CV is re-imported into an existing profile from the editor (no such flow exists today).
- De-duplicating repeated imports of the same CV (two imports may yield two profiles with the same suggested name).

---

## 4. Error States & UX

| Scenario | UI Behaviour |
|----------|-------------|
| File too large | Inline error: _"File must be under 5 MB."_ |
| Unsupported file type | Inline error: _"Only PDF or plain text files are supported."_ |
| Extraction partially failed | Info banner in editor: _"Some fields couldn't be extracted — please review."_ |
| Delete network error | Toast: _"Could not delete profile. Please try again."_ |

---

## 5. Out of Scope (MVP)

- Profile duplication / cloning
- Sharing or exporting a profile (other than as PDF CV)
- User-selectable / multiple CV templates (a single default template ships in §2.6; choosing between templates is deferred)
- Folder / tag organisation

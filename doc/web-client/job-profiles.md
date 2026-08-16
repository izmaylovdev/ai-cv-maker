# Job Profiles

A job profile is the central entity of the app. A user keeps one profile per
target role or industry; each holds a complete CV document and is the source
material for every generated CV.

**Code:** `apps/ui-angular/src/app/features/job-profiles/`, `apps/cv-api/Features/JobProfiles/`
**See also:** [profile-editing.md](profile-editing.md) (the editor itself) ·
[cv-generation.md](cv-generation.md) ·
[ADR-0013](../adr/0013-canonical-profile-document-model.md) /
[ADR-0014](../adr/0014-lexical-block-tree-profile-model.md) (the document model)

---

## What a user can do

**See all profiles.** `/job-profiles` lists every profile the signed-in user owns,
ordered by name. Each row shows the profile name plus the full name and title read
out of the profile's document header. With no profiles, an empty state prompts the
user to create one.

**Create a blank profile.** The user supplies a name (blank defaults to
`"My Profile"`) and lands in the editor at `/job-profiles/:id`. A new profile is
not empty — it is seeded with the default CV template (below), so the user sees
the expected section structure instead of a blank page.

**Create from an existing CV.** The user can attach a PDF in the create flow. The
app creates the profile, sends the extracted text to the LLM, and saves the
returned document into it. The LLM also proposes a profile name; a name the user
typed always wins, and the suggestion is only used when the field was left blank.
If extraction fails, the profile is still created — it just keeps its template
document and its original name.

**Rename.** A pencil action on each dashboard row turns the name into an inline
input; the profile name in the editor header is editable the same way. Enter or
clicking away saves, Escape cancels, and a blank name is discarded. Renaming never
navigates into the profile and never touches the document.

**Delete.** Deleting a profile also deletes every CV generated from it. Deletion is
confirmed first.

---

## The default template

`ProfileDocument.DefaultTemplate()` seeds a new profile with four titled sections
in order — **Professional Summary**, **Work Experience**, **Education**, **Skills**
— scaffolded as: an empty paragraph under the summary, a one-entry timeline under
each of work experience and education, and an empty chips group under skills.

The header (name, title, email, phone, location) and every content field start
**empty**: the template carries structure only, never placeholder or fake data.
Empty nodes render as editable scaffolding in the editor, and the PDF walk skips
them — so an untouched new profile still produces a near-empty PDF by design.

The template applies only to blank creation. Extraction overwrites the document
with what the LLM returned.

---

## Extraction pipeline

```
Angular: create profile → POST /api/job-profiles/{id}/extract (multipart)
  cv-api: .pdf → PdfPig text extraction | anything else → read as UTF-8 text
        → refuse if the text is empty
        → usage limit check → LlmService.ExtractAsync (gRPC) → usage recorded
        → MigrateLegacySections() on the returned document
        → respond { name, document }  (name = LLM suggestion, else current name)
Angular: PUT the returned document back onto the profile
```

The LLM returns the suggested name and the document **in one call** — the name is
a short role-oriented label (≤ 100 chars) derived from the CV's stated
professional title, else inferred from the most recent role, else the candidate's
full name. cv-api trims it and caps it at 100 characters; a blank suggestion falls
back to the profile's current name.

The upload input in the UI accepts `.pdf`; the API additionally accepts any other
file it can read as UTF-8 text. Request size is capped at **10 MB** by
`[RequestSizeLimit]`.

---

## API

All endpoints are under `api/job-profiles` and require a JWT. Ownership is checked
on every call — another user's profile is indistinguishable from a missing one
(`404`).

| Endpoint | Purpose | Returns |
|---|---|---|
| `GET /api/job-profiles` | List the caller's profiles | `[{ id, name, fullName, title }]` |
| `POST /api/job-profiles` | Create, seeded with the default template | `{ id, name, fullName, title }` |
| `GET /api/job-profiles/{id}` | Load one profile with its document | `{ id, name, document }` |
| `PUT /api/job-profiles/{id}` | Replace name + document | `{ id, name, document }` · `400` with `{ error }` when the document fails schema validation |
| `PATCH /api/job-profiles/{id}` | Rename only, document untouched | `{ id, name, fullName, title }` · `400` if blank or > 100 chars after trim |
| `DELETE /api/job-profiles/{id}` | Delete profile and its CVs | `204` |
| `POST /api/job-profiles/{id}/extract` | Extract a document from an uploaded CV | `{ name, document }` |
| `POST /api/job-profiles/{id}/chat` | Profile-scoped AI chat — see [chat.md](chat.md) | `{ reply, proposal }` |

`PUT` replaces the document wholesale (a null document becomes
`ProfileDocument.Empty()`), which is why rename has its own `PATCH` verb: a
name-only `PUT` would wipe the document.

**Extract error responses:** `400` no file uploaded or no text extractable ·
`404` unknown profile · `503` AI service unreachable (circuit open) or over quota ·
`502` other AI transport failure.

---

## Data

A profile row stores `Id`, `UserId`, `Name` (≤ 100 chars), and `Document` — the
canonical `ProfileDocument { header, body }` block tree persisted as a single
`jsonb` column. The pre-ADR-0013 structured shape (`fullName`/`workExperience`/
`education`/`skills`/`sectionOrder` columns) is gone; see
[ADR-0013](../adr/0013-canonical-profile-document-model.md) and
[ADR-0014](../adr/0014-lexical-block-tree-profile-model.md).

`GeneratedCv → Profile` is configured with `DeleteBehavior.Cascade`, so deleting a
profile removes its CVs in the database rather than in application code.

---

## Not implemented

Profile duplication, sharing, folders or tags, and a choice of CV templates (one
default template ships; picking between templates is deferred). Re-importing a CV
into an existing profile from the editor, and renaming from within the AI chat,
also do not exist.

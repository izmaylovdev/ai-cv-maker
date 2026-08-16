# CV Generation and PDF Export

A generated CV is an immutable snapshot: the AI rewrites the profile document for
a target role, and the result is stored as its own document so it stays
reproducible even after the source profile changes. Every PDF — generated,
saved-profile, or unsaved draft — goes through the same renderer.

**Code:** `apps/cv-api/Features/Cvs/`, `apps/cv-api/Infrastructure/ExternalServices/Pdf/PdfService.cs`,
`apps/ui-angular/src/app/features/pdf-preview/`
**See also:** [job-profiles.md](job-profiles.md) · [profile-editing.md](profile-editing.md) ·
[ai-usage.md](ai-usage.md) (cost and limits) ·
[ADR-0013](../adr/0013-canonical-profile-document-model.md)

---

## What a user can do

**Generate a tailored CV.** From a profile, the user optionally supplies
optimization notes (the target role, emphasis, tone) and the AI produces a
rewritten `ProfileDocument`. The result is saved as a `GeneratedCv` row, listed
under the profile with its creation time, notes, and title.

**Generate without picking a profile.** `POST /api/cvs/generate-auto` takes just
a job description. With one profile it uses that; with several it asks the LLM to
pick the best match first, then generates. This is the endpoint the Chrome
extension's auto-fill uses — see
[chrome-extension/auto-fill.md](../chrome-extension/auto-fill.md).

**Preview and download.** Any generated CV renders to PDF on demand. The file is
named `<FullName>_CV.pdf` (spaces become underscores).

**Export the profile itself.** The current saved profile can be rendered to PDF
with no AI involvement at all.

**Export unsaved editor state.** The editor's PDF action posts the on-screen
document — including unsaved edits — and renders it directly, without saving,
without an optimization-notes prompt, and without any AI call.

**Delete a generated CV.** Deleting a profile deletes its CVs with it.

---

## Generation flow

```
POST /api/job-profiles/{profileId}/cvs   { optimizationNotes? }
  → usage allowance check (ai-usage.md)
  → LlmService.GenerateAsync(profile document, notes, user's global preferences)
  → usage recorded as "Generate" / "GenerateAuto"
  → snapshot persisted: identity fields + the AI-authored document as JSON
```

The snapshot copies the profile's `FullName`, `Title`, `Location`,
`ContactEmail`, `ContactPhone` and the returned document (`CvDataJson`) at
generation time — the CV renders standalone and does not follow later edits to
the source profile.

The user's global preferences from [settings.md](settings.md) are passed into
every generation, so tone and style instructions apply without being restated.

---

## PDF rendering

PDFs are rendered with **QuestPDF** — A4, 40pt margins, Arial at 10pt base —
by walking the block tree directly. There is no HTML/headless-browser step and no
stored PDF: every request renders fresh, so there is no cache to invalidate and
no object storage in the path.

The walk skips empty nodes, which is why an untouched new profile still yields a
near-empty PDF rather than a page of blank scaffolding. Inline links render as
underlined hyperlinks within the paragraph text.

---

## API

| Endpoint | Purpose |
|---|---|
| `GET /api/job-profiles/{profileId}/cvs` | List generated CVs — `{ id, createdAt, optimizationNotes, title }` |
| `POST /api/job-profiles/{profileId}/cvs` | Generate one from the saved profile |
| `GET /api/job-profiles/{profileId}/cvs/{id}/pdf` | Render a generated CV — `application/pdf` |
| `GET /api/job-profiles/{profileId}/cvs/default/pdf` | Render the saved profile itself, no AI |
| `DELETE /api/job-profiles/{profileId}/cvs/{id}` | Delete a generated CV — `204` |
| `POST /api/cvs/generate-auto` | Pick the best profile for a job description, then generate — `{ cvId, profileId, fullName }` |
| `POST /api/cvs/draft-pdf` | Render an arbitrary `{ name, document }` payload — used for unsaved editor state |

**Errors:** `404` unknown or unowned profile/CV · `400` missing `jobDescription`
on generate-auto · `422` the user has no profiles · `503` AI service over quota ·
`502` other AI transport failure · `402 usage_limit_exceeded` when the spending
allowance is reached.

Note that `draft-pdf` renders whatever document it is given; it neither reads nor
writes stored data.

---

## Not implemented

Multiple PDF templates or themes, custom section labels, naming or tagging CV
versions, sharing a CV by public link, and ATS compatibility scoring. There is no
generation-rate limit distinct from the cost allowance in
[ai-usage.md](ai-usage.md).

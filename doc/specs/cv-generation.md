# Spec: CV Generation & PDF Export

**Source user stories:** US-CV-1 – US-CV-6  
**Feature area:** Generating tailored CVs and PDF export  
**Status:** Draft

---

## 1. Overview

From a saved profile a user can generate one or more tailored CV versions. Each generation invokes the AI with optional per-generation notes (e.g., a job description) and produces a structured CV document. All versions are stored with timestamps, can be previewed inline, and downloaded as PDF. A "raw export" path allows downloading the profile as PDF without any AI rewriting.

---

## 2. Functional Requirements

### 2.1 Generate a Tailored CV (US-CV-1)

| # | Requirement |
|---|-------------|
| F-CV-1.1 | A "Generate CV" action is available on the profile editor page. |
| F-CV-1.2 | An optional "Optimization notes" field accepts free-form text (e.g., a job description or role keywords). |
| F-CV-1.3 | The AI produces: professional summary (2–4 sentences), achievement-focused work experience entries, formatted education entries, a curated and normalized skills list, and 3–5 career highlights / differentiators. |
| F-CV-1.4 | A success notification confirms generation completion. |
| F-CV-1.5 | The new CV version appears in the generated CVs list with a creation timestamp. |

### 2.2 View Generated CVs (US-CV-2)

| # | Requirement |
|---|-------------|
| F-CV-2.1 | A "Generated CVs" section is accessible from the profile page. |
| F-CV-2.2 | Each entry shows the generation date and time. |
| F-CV-2.3 | Each entry has "Preview" and "Download" actions. |

### 2.3 Preview a Generated CV (US-CV-3)

| # | Requirement |
|---|-------------|
| F-CV-3.1 | Clicking "Preview" opens an inline PDF viewer (e.g., `<iframe>` or a PDF.js renderer). |
| F-CV-3.2 | The preview is full-width and legible without the user needing to download the file first. |
| F-CV-3.3 | A "Download" button is accessible from within the preview view. |

### 2.4 Download as PDF (US-CV-4)

| # | Requirement |
|---|-------------|
| F-CV-4.1 | The downloaded file is named `[FullName]_CV.pdf` (spaces replaced with underscores). |
| F-CV-4.2 | The PDF is A4 format with a professional layout. |
| F-CV-4.3 | The section order defined on the profile is respected. |

### 2.5 Raw Profile PDF Export (US-CV-5)

| # | Requirement |
|---|-------------|
| F-CV-5.1 | A "Download PDF" or "Open PDF" action is available directly on the profile card and/or profile page without triggering AI generation. |
| F-CV-5.2 | The output renders all profile sections as-is, with no AI rewriting. |
| F-CV-5.3 | Section order and skill order defined on the profile are respected. |

### 2.6 Delete a Generated CV (US-CV-6)

| # | Requirement |
|---|-------------|
| F-CV-6.1 | A delete action is available on each generated CV entry. |
| F-CV-6.2 | The user must confirm deletion via a dialog. |
| F-CV-6.3 | Deletion removes only that version; the underlying profile and other generated CVs are unaffected. |

---

## 3. Technical Specification

### 3.1 API Endpoints

#### `POST /api/profiles/:id/generate`

Generates a new CV version using AI.

**Request body:**
```json
{ "notes": "Applying for Senior React Developer at Stripe. Emphasise TypeScript and design systems." }
```
(`notes` is optional.)

**Response 201:**
```json
{
  "id": "cv-uuid",
  "profileId": "profile-uuid",
  "createdAt": "2024-06-01T14:30:00Z",
  "data": {
    "summary": "...",
    "workExperience": [ { "id": "entry-uuid", "description": "..." } ],
    "education": [ { "id": "entry-uuid", "formattedEntry": "..." } ],
    "skills": ["TypeScript", "React", "..."],
    "highlights": ["Led migration of monolith to micro-frontends...", "..."]
  }
}
```

**Response 422:** Profile not found or not owned by user.  
**Response 502:** Upstream AI error.

---

#### `GET /api/profiles/:id/generated-cvs`

Returns all generated CV versions for a profile, sorted by `createdAt` descending.

**Response 200:**
```json
[
  { "id": "cv-uuid", "createdAt": "2024-06-01T14:30:00Z", "notesSnippet": "Applying for..." }
]
```

---

#### `GET /api/profiles/:id/generated-cvs/:cvId/pdf`

Returns the PDF file for a specific generated CV version.

**Response 200:** `Content-Type: application/pdf` — the PDF binary stream.  
**Response 404:** CV version not found.

---

#### `GET /api/profiles/:id/pdf`

Returns a raw PDF export of the profile (no AI generation).

**Response 200:** `Content-Type: application/pdf` — the PDF binary stream.

---

#### `DELETE /api/profiles/:id/generated-cvs/:cvId`

Deletes a specific generated CV version.

**Response 204:** No content.  
**Response 404:** Not found or not owned by user.

---

### 3.2 AI Generation Prompt

```
You are a professional CV writer. Given the candidate's profile data, produce a tailored CV optimized for the role described in the notes.

Notes: {{notes || "No specific role — produce a general-purpose CV."}}

Profile data (JSON):
{{profileJson}}

Return a JSON object with this exact shape:
{
  "summary": "string (2-4 sentences)",
  "workExperience": [{ "id": "string", "description": "string" }],
  "education": [{ "id": "string", "formattedEntry": "string" }],
  "skills": ["string"],
  "highlights": ["string (3-5 items)"]
}

Rules:
- Preserve all factual data (company names, dates, job titles, institutions).
- Use active voice, achievement language, and quantify impact where evidence exists in the profile.
- Skills should be relevant first; omit skills unrelated to the target role if notes specify one.
- Highlights are 3–5 concise differentiators (one sentence each).
```

Server validates the AI response JSON before persisting the `GeneratedCV` record.

### 3.3 PDF Rendering Pipeline

Both generated and raw CV PDFs use the same rendering pipeline:

```
Server assembles CV data (AI-generated or raw profile)
  → Pass to PDF renderer (see options below)
  → Return PDF binary as HTTP response
```

**Recommended PDF renderer options:**
- **Puppeteer** (headless Chromium): render a server-side HTML template to PDF. Gives full CSS control and A4 layout. Trade-off: higher memory usage.
- **PDFKit** or **pdfmake**: programmatic PDF generation. Lighter weight but less design flexibility.

Chosen approach should be documented in `ARCHITECTURE.md`.

**PDF requirements:**
- Page size: A4 (210 × 297 mm)
- Margins: 15 mm all sides
- Font: system-safe serif or sans-serif (e.g., Inter, or embed a font subset)
- File name header: set via `Content-Disposition: attachment; filename="<FullName>_CV.pdf"`

### 3.4 Section Order in PDF

Both the raw export and generated CV must iterate sections in the order defined by `Profile.sectionOrder`. Within each section, entries follow the same order as stored in the profile (work/education by date, skills by user-defined order).

### 3.5 Data Model

```ts
interface GeneratedCV {
  id: string;            // UUID v4
  profileId: string;     // FK → Profile.id
  userId: string;        // FK → User.id (denormalised for faster access control checks)
  notes?: string;        // the optimization notes used at generation time
  data: GeneratedCVData; // AI output, stored as JSON
  pdfUrl?: string;       // optional: pre-generated PDF stored in object storage
  createdAt: Date;
}

interface GeneratedCVData {
  summary: string;
  workExperience: { id: string; description: string }[];
  education: { id: string; formattedEntry: string }[];
  skills: string[];
  highlights: string[];
}
```

### 3.6 PDF Storage Strategy

**Option A — On-demand rendering (MVP):** PDF is generated fresh on each download request. Simpler, no storage cost, slightly slower.

**Option B — Pre-generated & cached:** PDF generated once after AI call, stored in object storage (e.g., S3/Azure Blob), served via signed URL. Faster downloads but adds infrastructure complexity.

**Recommendation for MVP:** Option A. Migrate to Option B if PDF generation latency becomes a problem.

### 3.7 Rate Limiting

- AI generation: max **5 generations per profile per hour** per user.
- Raw PDF export: no rate limit (pure rendering, no AI cost).
- HTTP 429 returned when limit exceeded.

---

## 4. Error States & UX

| Scenario | UI Behaviour |
|----------|-------------|
| Generation in progress | Button disabled; spinner; _"Generating your CV…"_ |
| AI generation fails | Toast: _"CV generation failed. Please try again."_ |
| PDF download fails | Toast: _"Could not download PDF. Please try again."_ |
| Rate limit hit | Toast: _"You've reached the generation limit. Try again later."_ |
| Delete confirm | Dialog: _"Delete this CV version? This cannot be undone."_ |

---

## 5. Out of Scope (MVP)

- Multiple PDF templates / themes
- Custom section headers or labels
- CV version naming / tagging
- Sharing a generated CV via a public link
- ATS (Applicant Tracking System) compatibility scoring

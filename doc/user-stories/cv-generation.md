# CV Generation & PDF Export

## Overview

From a saved profile a user can generate one or more tailored CV versions. Each generation calls the AI with optional per-generation notes (e.g., a specific job description) to produce a polished CV. All generated versions are stored, can be previewed inline, and exported as a PDF.

---

## User Stories

### US-CV-1 — Generate a tailored CV

**As a** user with a saved profile,
**I want to** generate a CV tailored to a specific job or role,
**so that** each application I send is customized rather than generic.

**Acceptance criteria:**
- I can trigger generation from the profile page.
- An optional "optimization notes" field accepts free-form text (e.g., a job description or target role keywords).
- The AI produces:
  - A professional summary (2–4 sentences)
  - Achievement-focused work experience entries
  - Formatted education entries
  - A curated, normalized skills list
  - 3–5 career highlights / differentiators
- Generation completes with a success notification.
- The new CV version appears in my list of generated CVs with a timestamp.

---

### US-CV-2 — View all generated CVs for a profile

**As a** user,
**I want to** see a list of all CVs I have generated for a profile (with timestamps),
**so that** I can track which version I sent to which employer.

**Acceptance criteria:**
- Each entry in the list shows the generation date/time.
- I can open a preview or download any version.

---

### US-CV-3 — Preview a generated CV

**As a** user,
**I want to** preview a generated CV as a formatted document before downloading,
**so that** I can confirm it looks right without opening a separate PDF viewer.

**Acceptance criteria:**
- Clicking a generated CV opens an inline PDF viewer.
- The preview is full-width and legible without downloading.
- A download button is accessible from within the preview.

---

### US-CV-4 — Download a generated CV as PDF

**As a** user,
**I want to** download any generated CV as a PDF file,
**so that** I can attach it to a job application.

**Acceptance criteria:**
- The downloaded file is named `[FullName]_CV.pdf`.
- The PDF is A4 format with a professional layout.
- The section order defined on the profile is respected.

---

### US-CV-5 — Download the raw profile as PDF (no AI generation)

**As a** user,
**I want to** export my profile data directly as a PDF without running AI generation,
**so that** I have a quick way to get a plain CV from my saved data.

**Acceptance criteria:**
- A "Download PDF" or "Open PDF" action is available directly on the profile card/page.
- The output renders all profile sections as-is with no AI rewriting.
- Section order and skill order defined on the profile are respected.

---

### US-CV-6 — Delete a generated CV

**As a** user,
**I want to** delete specific generated CV versions,
**so that** I can keep my list tidy and remove outdated drafts.

**Acceptance criteria:**
- A delete action is available on each generated CV entry.
- I am asked to confirm before deletion.
- Deletion does not affect the underlying profile or other generated versions.

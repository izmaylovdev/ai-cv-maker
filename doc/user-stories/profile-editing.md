# Profile Editing

## Overview

The profile editor is a split-panel screen: a form on the left and a live CV preview on the right. Users fill in structured data across four sections — personal info, work experience, education, and skills — and control which sections appear in their CV and in what order.

---

## User Stories

### US-EDIT-1 — Edit personal information

**As a** user,
**I want to** enter my full name, professional title, summary, location, email, and phone number,
**so that** the generated CV shows accurate contact and identity details.

**Acceptance criteria:**
- Full name and professional title are required; the form prevents saving without them.
- Phone number is auto-formatted with a mask as I type.
- Changes are reflected immediately in the live preview panel.

---

### US-EDIT-2 — Add and manage work experience entries

**As a** user,
**I want to** add multiple work experience entries (company, role, dates, description),
**so that** my employment history is captured in full.

**Acceptance criteria:**
- I can add as many entries as needed.
- I can remove any entry with a single action (with confirmation).
- "Current role" is supported by leaving the end date blank.
- Entries are displayed sorted by most recent start date.

---

### US-EDIT-3 — Add and manage education entries

**As a** user,
**I want to** add education entries (institution, degree, field of study, years),
**so that** my academic background appears on the CV.

**Acceptance criteria:**
- I can add multiple entries and remove any.
- End year can be left blank for ongoing education.
- Entries are sorted by most recent start year.

---

### US-EDIT-4 — Add and reorder skills

**As a** user,
**I want to** add skills and drag them into priority order,
**so that** my most relevant skills appear first in the generated CV.

**Acceptance criteria:**
- I can add skills one at a time and remove individual skills.
- Drag-and-drop reordering is supported within the skills list.
- The order I set is preserved when the CV is generated.

---

### US-EDIT-5 — Customize CV section order

**As a** user,
**I want to** choose which sections appear in my CV and reorder them,
**so that** I can put my strongest selling point first (e.g., skills before experience for a career changer).

**Acceptance criteria:**
- A dedicated dialog lists all sections (Work Experience, Education, Skills).
- I can reorder them via drag-and-drop.
- I can toggle sections on or off.
- The live preview and all future PDF exports respect my chosen order.

---

### US-EDIT-6 — Live CV preview while editing

**As a** user,
**I want to** see a formatted preview of my CV update as I edit,
**so that** I can judge how the final document will look without generating a PDF.

**Acceptance criteria:**
- The right panel renders a styled CV preview.
- Edits to any field are reflected in near real-time.
- Scrolling to a section in the form auto-scrolls the preview to the same section.

---

### US-EDIT-7 — Save profile changes

**As a** user,
**I want to** explicitly save my profile with a "Save" action,
**so that** I have control over when changes are persisted.

**Acceptance criteria:**
- A clear "Save" button is present in the editor.
- A success notification confirms the save.
- Unsaved changes are not lost on accidental navigation (the user is warned).

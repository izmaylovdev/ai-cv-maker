# Profile Editing

> **Superseded — read first (ADR-0013).** US-EDIT-1 – US-EDIT-7 (the structured
> split-panel editor over a `WorkExperience`/`Education`/`Skill` model) have been
> **retired**. The canonical profile editor is the **Document Builder**
> (US-EDIT-8 – US-EDIT-12 below), embedded in the Angular SPA at
> `/job-profiles/:id` as `<applysy-profile-builder>`, operating on the canonical
> `ProfileDocument { header, sections[] }`. US-EDIT-1 – US-EDIT-7 are kept for
> history; do not implement against them.

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

---

## Document Builder (canonical — ADR-0013)

The canonical editing experience, which replaced the structured split-panel
editor above. It presents the profile as a **single editable document** built
from **general-purpose sections**. Each section can be empty/free-form or follow
a **predefined template** (e.g. a Timeline of dated entries — work experience,
education, projects — each with Title, Dates, and Description; or a bulleted
List). Delivered as a **reusable web component** (`<applysy-profile-builder>`)
and embedded in the Angular SPA at `/job-profiles/:id`. Per ADR-0013 its
`ProfileDocument { header, sections[] }` is now the canonical persisted shape
end to end — persistence (cv-api jsonb), the gRPC contract, the LLM service, and
PDF rendering all speak it.

### US-EDIT-8 — Edit my profile as a single document

**As a** user,
**I want to** edit my profile as one continuous document made of stacked sections,
**so that** building my profile feels like writing a document rather than filling separate forms.

**Acceptance criteria:**
- The builder renders as a single scrollable document composed of vertically stacked sections.
- I can edit content directly in place; there is no separate "edit mode" toggle per field.
- An empty document shows clear guidance on how to add my first section.

### US-EDIT-9 — Add sections from a template palette

**As a** user,
**I want to** add a new section by choosing from a list of section templates (including a blank/general-purpose one),
**so that** I get the right structure for the content I'm about to write without building it by hand.

**Acceptance criteria:**
- An "Add section" action presents a palette of available templates, including at least a general-purpose (blank) section and a Timeline (dated entries) section.
- Each template shows a name and a short description of what it's for.
- Choosing a template inserts a new section at the chosen position in the document.
- Each template seeds the section with its predefined fields/placeholders.

### US-EDIT-10 — Structured dated entries via the Timeline template

**As a** user,
**I want to** a single Timeline template that gives each entry a Title, a Dates field, and a Description, which I can name (via its heading) for work experience, education, projects, etc.,
**so that** any dated history is captured with consistent structure without duplicate templates or me defining the fields.

**Acceptance criteria:**
- A Timeline section holds one or more entries, each with Title, a Dates field, and a Description.
- The Dates field is a single free-text field I type the range into (e.g. "Jan 2022 – Present").
- I can rename the section via its heading (e.g. "Work Experience", "Education").
- I can add and remove entries within the section.
- The template's field labels and placeholders make the expected content obvious.

### US-EDIT-11 — General-purpose (free-form) sections

**As a** user,
**I want to** add a general-purpose section with a heading and free-form rich text,
**so that** I can capture content that doesn't fit a predefined template.

**Acceptance criteria:**
- A general-purpose section has an editable heading and a free-form text body.
- The section places no constraints on the body content beyond plain rich text.
- A general-purpose section can be added, edited, and removed like any other.

### US-EDIT-12 — Reorder and remove sections and items

**As a** user,
**I want to** reorder sections within the document and remove ones I don't need,
**so that** I control the structure and flow of my profile document.

**Acceptance criteria:**
- Sections can be reordered within the document via drag-and-drop.
- Any section can be removed, with confirmation when it contains content.
- Items within a templated section (e.g. a Timeline) can likewise be reordered and removed.
- The document's visual order reflects the order I set at all times.

### US-EDIT-13 — Chip-list template for tag-style content

**As a** user,
**I want to** add a section whose items render as compact chips/tags (e.g. skills, tools, languages) rather than a bulleted list,
**so that** short, scannable items read as a tag cloud both in the editor and on the generated CV.

**Acceptance criteria:**
- The "Add section" palette includes a **Chip-list** template, with a name and one-line description, alongside the existing General-purpose, Timeline, and List templates.
- A Chip-list section holds an ordered set of short text items, each shown as a chip/tag.
- I can add and remove individual chips; adding a chip and confirming an edit work via the keyboard.
- The chosen order of chips is preserved and respected in the generated PDF.
- The generated CV renders the section's items as chips/tags, not as a bulleted list.

---

## Block-based sections (supersedes template-per-section — ADR-0014)

> **Supersedes US-EDIT-9 – US-EDIT-13.** US-EDIT-14 replaces the section model:
> sections are no longer bound to a single template by type. The profile becomes
> a **structured rich-text document** edited in one versatile editor, built from
> a **closed set of predefined widgets** — **text** (a paragraph), **chips** (tag
> cloud), **list** (bullets), and **timeline** (dated entries). Crucially the
> document is a **tree**: widgets can nest inside other widgets (e.g. a list
> inside a text block, or a list inside a timeline entry's description). The
> "Add section" template palette is retired; the user composes content inline by
> typing and inserting widgets anywhere. US-EDIT-9 – US-EDIT-13 are kept for
> history; do not implement against them.

### US-EDIT-14 — Compose the profile in a versatile widget editor

**As a** user,
**I want to** write my profile in a single rich-text editor where I can type
text and insert predefined widgets (chips, lists, timelines) anywhere — including
nested inside one another,
**so that** I can shape my profile freely with structured content instead of
being locked into fixed per-section templates.

**Acceptance criteria:**
- The whole profile body is one continuous rich-text document (a single editor
  instance), not a stack of separate per-section editors; I add a section by
  giving it a heading, with no up-front template choice.
- Sections are structural blocks within that one document and I can reorder them
  easily (drag handle / move up-down) without leaving the editor; reordering a
  section moves all of its content with it.
- I can insert any predefined widget — text, chips, list, or timeline — at the
  caret, and only those predefined widgets are available (no arbitrary HTML).
- Widgets can nest inside the rich-text content of other widgets where it makes
  sense — e.g. a list inside a text block, or a list inside a timeline entry's
  description — to the depth the editor allows.
- Each widget keeps its editing affordances: text is free-form rich text; chips
  are short tag items; list is bulleted items (each item itself rich content);
  timeline holds dated entries with Title, Dates, and a rich-content Description.
- I can reorder and remove individual widgets and sections; the document's
  visual order always reflects the order I set.
- An empty section/document shows guidance prompting me to start typing or insert
  my first widget.
- The generated CV and live rendering reflect each widget in its type, nesting,
  and order.

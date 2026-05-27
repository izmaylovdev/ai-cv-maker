# Spec: Profile Editing

**Source user stories:** US-EDIT-1 – US-EDIT-7  
**Feature area:** Editing personal info, experience, education, and skills  
**Status:** Draft

---

## 1. Overview

The profile editor is a split-panel screen at `/profiles/:id`. The left panel contains a structured form; the right panel shows a live, styled CV preview that updates in near real-time as the user types. Users control which sections appear in the CV and their order. Changes are persisted explicitly via a "Save" action.

---

## 2. Functional Requirements

### 2.1 Edit Personal Information (US-EDIT-1)

| # | Requirement |
|---|-------------|
| F-EDIT-1.1 | The personal info section contains: Full Name, Professional Title, Summary, Location, Email, Phone. |
| F-EDIT-1.2 | Full Name and Professional Title are required; the Save button is disabled and an inline error is shown if either is empty. |
| F-EDIT-1.3 | Phone number is auto-formatted with a mask as the user types (e.g., `+1 (555) 000-0000`). |
| F-EDIT-1.4 | All changes are reflected in the live preview panel immediately (debounced ≤ 300 ms). |

### 2.2 Work Experience (US-EDIT-2)

| # | Requirement |
|---|-------------|
| F-EDIT-2.1 | Users can add multiple work experience entries. |
| F-EDIT-2.2 | Each entry has: Company, Role, Start Date (month/year), End Date (month/year, optional), Description (multi-line). |
| F-EDIT-2.3 | Leaving End Date blank marks the entry as "Current role" and displays "Present" in the CV. |
| F-EDIT-2.4 | A single action removes an entry; the user is asked to confirm if the description is non-empty. |
| F-EDIT-2.5 | Entries are displayed sorted by Start Date descending (most recent first). |

### 2.3 Education (US-EDIT-3)

| # | Requirement |
|---|-------------|
| F-EDIT-3.1 | Users can add multiple education entries. |
| F-EDIT-3.2 | Each entry has: Institution, Degree, Field of Study, Start Year, End Year (optional). |
| F-EDIT-3.3 | Leaving End Year blank displays "Present" (for ongoing studies). |
| F-EDIT-3.4 | Users can remove any entry. |
| F-EDIT-3.5 | Entries are sorted by Start Year descending. |

### 2.4 Skills (US-EDIT-4)

| # | Requirement |
|---|-------------|
| F-EDIT-4.1 | Users can add skills one at a time (e.g., via an input + "Add" button or pressing Enter). |
| F-EDIT-4.2 | Individual skills can be removed (× button on each skill chip/tag). |
| F-EDIT-4.3 | Skills support drag-and-drop reordering within the list. |
| F-EDIT-4.4 | The order set by the user is preserved in the profile and respected in CV generation and PDF export. |

### 2.5 CV Section Order (US-EDIT-5)

| # | Requirement |
|---|-------------|
| F-EDIT-5.1 | A "Customize sections" dialog lists all CV sections: Work Experience, Education, Skills. |
| F-EDIT-5.2 | Users can reorder sections via drag-and-drop within the dialog. |
| F-EDIT-5.3 | Users can toggle individual sections on or off. |
| F-EDIT-5.4 | The chosen order and visibility is reflected immediately in the live preview. |
| F-EDIT-5.5 | All PDF exports (raw and AI-generated) respect this section order. |

### 2.6 Live Preview (US-EDIT-6)

| # | Requirement |
|---|-------------|
| F-EDIT-6.1 | The right panel renders a styled CV preview at all times. |
| F-EDIT-6.2 | Edits to any form field update the preview within ≤ 300 ms (debounced, no server round-trip). |
| F-EDIT-6.3 | Scrolling to a section in the form auto-scrolls the preview pane to the corresponding section. |
| F-EDIT-6.4 | The preview is read-only (not directly editable). |

### 2.7 Save (US-EDIT-7)

| # | Requirement |
|---|-------------|
| F-EDIT-7.1 | A "Save" button is present in the editor toolbar. |
| F-EDIT-7.2 | A success notification (toast) confirms the save. |
| F-EDIT-7.3 | Navigating away with unsaved changes triggers a browser confirmation dialog: _"You have unsaved changes. Leave anyway?"_ |
| F-EDIT-7.4 | The "Save" button is visually marked when there are unsaved changes (e.g., labelled "Save •"). |

---

## 3. Technical Specification

### 3.1 API Endpoints

#### `GET /api/profiles/:id`

Returns the full profile including all nested entries.

**Response 200:** Full `Profile` object (see data model in job-profiles spec §3.4).  
**Response 404:** Not found or not owned by user.

---

#### `PUT /api/profiles/:id`

Replaces the entire profile payload. The client sends the full profile on every save.

**Request body:** Full `Profile` object (minus `id`, `userId`, `createdAt`).

**Response 200:** Updated `Profile`.  
**Response 422:** Validation error — missing `fullName` or `title`.

---

### 3.2 Form State Management

- Use a form state library (e.g., React Hook Form) with a single top-level `useForm` instance for the entire editor.
- Track a `isDirty` flag to enable the unsaved-changes guard.
- On load, populate form state from `GET /api/profiles/:id`.
- On save, serialize form state and `PUT /api/profiles/:id`.

### 3.3 Live Preview Sync

- The preview component subscribes to the form `watch()` output.
- A `useDebounce(formValues, 300)` hook limits re-renders.
- Scroll-sync uses `IntersectionObserver` on section headings in both panels; scrolling either panel highlights the active section in the form nav and scrolls the preview to match.

### 3.4 Phone Number Masking

Use `react-phone-number-input` or `imask` for auto-formatting. Store the raw E.164 value in state; display the formatted value in the input.

### 3.5 Drag-and-Drop

Use `@dnd-kit/core` (or `react-beautiful-dnd`) for:
- Skills list reordering (within the skills section).
- Section order reordering (within the customize-sections dialog).

Both lists must support keyboard accessibility (arrow keys to move, Enter/Space to drop).

### 3.6 Date Validation

| Field | Format | Validation |
|-------|--------|------------|
| Work Start Date | YYYY-MM | Required; must be ≤ today |
| Work End Date | YYYY-MM | Optional; if set, must be ≥ Start Date |
| Education Start Year | YYYY | Required; 4-digit year |
| Education End Year | YYYY | Optional; if set, must be ≥ Start Year |

### 3.7 Unsaved Changes Guard

- Listen to the browser `beforeunload` event when `isDirty === true`.
- For in-app navigation (React Router), use a `<Prompt>` component or `useBlocker` hook to intercept route changes.

---

## 4. UI Layout

```
┌──────────────────────────────┬────────────────────────────┐
│  Editor (left panel)         │  CV Preview (right panel)  │
│  ─────────────────────       │  ──────────────────────    │
│  [Personal Info]             │                            │
│  [Work Experience]           │   ┌────────────────────┐   │
│  [Education]                 │   │  Jane Doe          │   │
│  [Skills]                    │   │  Senior Dev        │   │
│  [Customize Sections ↗]      │   │  ...               │   │
│                              │   └────────────────────┘   │
│  [Save •]                    │                            │
└──────────────────────────────┴────────────────────────────┘
```

- On mobile (< 768 px): panels stack vertically; preview collapses to a toggle.
- The editor panel is scrollable independently of the preview panel.

---

## 5. Error States & UX

| Scenario | UI Behaviour |
|----------|-------------|
| Save fails (network) | Toast: _"Could not save. Please try again."_ |
| Required field empty on save attempt | Inline error under the field; form scrolls to first error |
| Entry removal (non-empty description) | Confirmation dialog: _"Remove this experience entry?"_ |
| Drag-and-drop not supported | Fallback: up/down arrow buttons |

---

## 6. Out of Scope (MVP)

- Rich-text formatting in description fields
- Auto-save / draft mode
- Undo/redo history
- Collaborative editing

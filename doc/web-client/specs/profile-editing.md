# Spec: Profile Editing

**Source user stories:** US-EDIT-1 – US-EDIT-7 (structured editor, superseded); US-EDIT-8 – US-EDIT-12 (document builder, now canonical)  
**Feature area:** Editing the profile document (identity/contact header + freely added sections)  
**Status:** Sections 1–6 superseded by ADR-0013; section 7 (Document Builder) is the canonical editor

> **Superseded — read first (ADR-0013).** Sections 1–6 below describe the
> original **structured** split-panel editor (fixed personal-info / experience /
> education / skills forms over a `WorkExperience`/`Education`/`Skill` model).
> That editor and that data model have been **retired**. The canonical profile
> editor is now the **document builder** specified in **§7**, embedded in the
> Angular SPA at `/job-profiles/:id` as `<applysy-profile-builder>`, operating on
> the canonical `ProfileDocument { header, sections[] }` (ADR-0013). Sections 1–6
> are kept for history; do not implement against them.

---

## 1. Overview

> Historical (superseded by §7 / ADR-0013).

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

---

## 7. Document Builder (US-EDIT-8 – US-EDIT-12)

> **Status:** Canonical (ADR-0013). This section specifies the editing
> experience delivered as a standalone, reusable **React** component, packaged
> as a self-contained web component and embedded in the Angular SPA — the same
> pattern as the existing `apps/chat-ui` chat widget (Angular remains the sole
> production SPA per CLAUDE.md; this is an embedded widget, not a second SPA).
> It has **replaced** the structured editor in sections 1–6. Persistence, the
> REST API, the data model, and the CV-generation/AI/PDF wiring now all speak the
> document model end to end (ADR-0013): cv-api stores it as a JSON column,
> `GET/PUT /api/job-profiles/:id` exchange `{ id, name, document }`,
> extract / chat operate on the document, and the PDF renders it. The widget
> itself stays host-agnostic (no fetch/auth/routing): the host seeds the document
> and listens for `documentchange`.

### 7.1 Functional Requirements

#### Document canvas (US-EDIT-8)

| # | Requirement |
|---|-------------|
| F-EDIT-8.1 | The builder renders as a single, vertically scrollable document composed of stacked sections. |
| F-EDIT-8.2 | Content is edited in place — there is no per-field or per-section "edit mode" toggle. |
| F-EDIT-8.3 | When the document has no sections, an empty state is shown with a primary "Add section" affordance and guidance text. |
| F-EDIT-8.4 | The component reflects the supplied document model on load and emits the updated model on every change (UX phase: no persistence side effects). |

#### Template palette (US-EDIT-9)

| # | Requirement |
|---|-------------|
| F-EDIT-9.1 | An "Add section" action opens a palette listing the available section templates. |
| F-EDIT-9.2 | The palette includes a **General-purpose (blank)** template, a **Timeline** (dated entries) template, and a **List** (bulleted) template. |
| F-EDIT-9.3 | Each palette entry shows the template name and a one-line description of its purpose. |
| F-EDIT-9.4 | Selecting a template inserts a new section at the requested position (end of document by default, or relative to the invoking insertion point). |
| F-EDIT-9.5 | A newly inserted section is seeded from the template (heading text, placeholder fields, and — for item-based templates — one empty starter item). |
| F-EDIT-9.6 | The set of templates is sourced from an extensible registry, so additional templates can be added later without changing the canvas. |

#### Timeline template (US-EDIT-10)

| # | Requirement |
|---|-------------|
| F-EDIT-10.1 | A Timeline is a single generic dated-entries section (suiting work experience, education, projects, …); it contains an ordered list of items, each with Title, a single free-text Dates field, and a Description. The user names the section via its editable heading. |
| F-EDIT-10.2 | Users can add an item (appended to the section) and remove any item. |
| F-EDIT-10.3 | The Dates field is free text the user types as a single range (e.g. "Jan 2022 – Present"); the builder does not parse or auto-derive it. |
| F-EDIT-10.4 | Each field shows a descriptive label and placeholder that make the expected content obvious (e.g. Title → "Title — role, degree, or project", Dates → "Jan 2022 – Present"). |

#### General-purpose section (US-EDIT-11)

| # | Requirement |
|---|-------------|
| F-EDIT-11.1 | A general-purpose section has an editable heading and a free-form multi-line text body. |
| F-EDIT-11.2 | The body imposes no structural constraints beyond plain (UX-phase) text; rich-text formatting is out of scope (§7.5). |
| F-EDIT-11.3 | A general-purpose section supports the same add / edit / remove lifecycle as any other section. |

#### Reorder & remove (US-EDIT-12)

| # | Requirement |
|---|-------------|
| F-EDIT-12.1 | Sections can be reordered within the document via drag-and-drop, with an accessible keyboard/arrow-button fallback. |
| F-EDIT-12.2 | Any section can be removed; removal of a non-empty section requires confirmation. |
| F-EDIT-12.3 | Items within a **Timeline** section can be reordered and removed via hover controls. |
| F-EDIT-12.4 | The rendered order always matches the model order; the emitted model reflects every reorder. |
| F-EDIT-12.5 | **List** items are edited like a document — Enter starts a new bullet, Backspace at the start of a line removes/merges it, Arrow Up/Down move between lines — without per-item buttons. |

### 7.2 Document Model

The widget is driven by a plain, serialisable (JSON-safe) model. Per ADR-0013 it
**is** the canonical persisted `Profile.Document` shape — cv-api stores it as a
JSON column and the gRPC proto / llm-service / PDF mirror it. The TypeScript
definition in `apps/profile-builder-ui/src/model.ts` is the reference. In
addition to `sections`, the document carries a fixed identity/contact `header`
(`fullName`, `title`, `email`, `phone`, `location`) — the letterhead every CV
needs, not an addable/removable section.

```ts
type SectionTemplateId = 'free-form' | 'timeline' | 'list'; // extensible

interface ProfileDocument {
  header: ProfileHeader;          // fixed identity/contact letterhead
  sections: DocumentSection[];
}

interface ProfileHeader {
  fullName: string;
  title: string;
  email: string;
  phone: string;
  location: string;
}

type DocumentSection = FreeFormSection | EntrySection | ListSection;

interface SectionBase {
  id: string;            // client-generated (e.g. crypto.randomUUID())
  template: SectionTemplateId;
  heading: string;
}

interface FreeFormSection extends SectionBase {
  template: 'free-form';
  body: string;
}

// A "Timeline": one generic dated-entries section that suits work experience,
// education, projects, etc. The user names it via the (editable) heading.
interface EntrySection extends SectionBase {
  template: 'timeline';
  items: EntryItem[];
}

interface EntryItem {
  id: string;
  title: string;
  dates: string;         // free-text range, e.g. "Jan 2022 – Present"
  description: string;
}

interface ListSection extends SectionBase {
  template: 'list';
  items: ListItem[];     // a simple bulleted list (skills, tools, …)
}

interface ListItem {
  id: string;
  text: string;
}
```

A **template registry** describes each available template and how to create a seeded section:

```ts
interface SectionTemplate {
  id: SectionTemplateId;
  name: string;          // shown in the palette
  description: string;   // one-line purpose, shown in the palette
  create(): DocumentSection;   // returns a seeded section with a fresh id
}
```

### 7.3 Component / Library Design (React)

#### Packaging

- New Nx app `apps/profile-builder-ui` (React + Vite), mirroring `apps/chat-ui`: `project.json` with `build` (Vite IIFE lib), `dev`, and `test` (Vitest) targets; CSS bundled into the JS so the artifact is self-contained.
- The build emits a single self-contained bundle (e.g. `profile-builder.js`) that registers a custom element **`<applysy-profile-builder>`** via `customElements.define`, exactly like `<ai-chat-widget>` in `apps/chat-ui/src/main.tsx`.
- React internals are private; the public contract is the custom element's attributes/events plus the exported model types (§7.2).

#### React component tree

| Component | Responsibility |
|---|---|
| `ProfileBuilder` | Root. Holds document state (`useState<ProfileDocument>`), renders the canvas, the "Add section" palette trigger, the empty state, and section-level drag-and-drop. Emits changes upward. |
| `SectionFrame` | Per-section chrome shared by all templates: drag handle, heading edit, remove action + confirmation, children slot. |
| `EntrySection` | Renders/edits a Timeline section (one generic dated-entries type): item list, add/remove/reorder items. |
| `EntryItem` | Single dated entry: Title, free-text Dates, Description. |
| `ListSection` | Renders/edits a bulleted List section **like a document** (Word / Google Docs): Enter starts a new bullet (splitting at the caret), Backspace at the start of a line merges it into the previous one, Arrow Up/Down move between lines. No per-item buttons. |
| `FreeFormSection` | Renders/edits a general-purpose section: heading + free-form body. |
| `AddSectionPalette` | Lists templates from the registry; calls back with the chosen template + insert position. |

- Drag-and-drop via a lightweight React DnD approach (HTML5 drag events or a small library), with an accessible arrow-button fallback (F-EDIT-12.1). No Angular CDK.

#### Web-component I/O (UX phase)

The custom element is the host-agnostic boundary — no `fetch`, no auth, no routing inside it:

| Channel | Direction | Detail |
|---|---|---|
| `document` attribute/property | host → widget | Initial `ProfileDocument` as a JSON string (attribute) or object (property), mirroring chat-ui's `auth-token` / `api-base` attribute style. |
| `documentchange` `CustomEvent` | widget → host | Dispatched on every edit; `event.detail` carries the current `ProfileDocument`. |

- The `ProfileBuilder` React component also has a plain props interface (`document`, `onChange`) so it can be used directly in React contexts (tests, Storybook-style harness) without the custom-element wrapper.

#### Theming

- Light and dark themes are driven entirely by CSS custom properties on `.pb-root`. Dark values are applied under `.dark .pb-root`, matching `@applysy/theme`'s convention of toggling a `dark` class on `<html>` — so the widget follows the host's theme (and the dev-shell toggle) with no JS.

#### Template extensibility

- A default registry (`DEFAULT_SECTION_TEMPLATES`) ships with `free-form`, `timeline`, and `list`.
- The registry is passed in (prop) with the default applied when absent, so a host can supply additional templates without modifying the widget.

### 7.4 Demo / Harness

- **Standalone dev harness:** `apps/profile-builder-ui` runs on its own Vite dev server (own port, mirroring chat-ui's 4202) with an `index.html` that mounts the widget seeded with an in-memory sample document — the primary surface for building and reviewing the UX. No backend calls.
- **Angular embedding (optional, later in this phase):** load the bundle via a script loader and render `<applysy-profile-builder>` behind an experimental route in `apps/ui-angular` (e.g. `/profiles/:id/document`), reusing the chat-widget loader pattern (`chat-loader.service.ts`, `chatWidgetUrl` env entry).

### 7.5 Out of Scope

> Persistence, the REST API, the data model, and CV-generation / PDF / AI-optimize
> / chat wiring were listed as out of scope during the original UX-only phase.
> They have since been **delivered** under ADR-0013 (the document model is now
> canonical end to end); the items below are the remaining genuine out-of-scope
> items.

- Rich-text formatting, auto-save, undo/redo, collaborative editing (consistent with §6).
- Date pickers / validation on Timeline entry dates (free-text by design).
- Additional templates beyond General-purpose, Timeline, List, and Chip-list (registry-ready, but not built now).

---

## 8. Chip-list Template (US-EDIT-13)

> **Status:** Canonical (extends §7 / ADR-0013). Adds a fourth section template,
> `chip-list`, to the document builder. It shares the `list` template's data
> shape (an ordered set of `{ id, text }` items) but is a **distinct section
> type** with its own discriminant, palette entry, in-editor rendering (chips/
> tags), and PDF rendering. Because the document model is canonical end to end
> (ADR-0013), the new template id is mirrored across the gRPC proto, cv-api
> (`ProfileDocument` + persisted JSON), the PDF renderer, the llm-service
> schemas, and the Angular profile model.

### 8.1 Functional Requirements

| # | Requirement |
|---|-------------|
| F-EDIT-13.1 | The "Add section" palette includes a **Chip-list** template with a name and one-line description, alongside General-purpose, Timeline, and List (extends F-EDIT-9.2). |
| F-EDIT-13.2 | A Chip-list section (`template: 'chip-list'`) holds an ordered list of items, each `{ id, text }`, seeded with one empty starter item on insert (consistent with F-EDIT-9.5). |
| F-EDIT-13.3 | Each item renders as a chip/tag in the editor; the user types directly into a chip. |
| F-EDIT-13.4 | The user can add a chip (Enter on a chip appends a new empty chip after it) and remove a chip (a × control on each chip, and Backspace on an empty chip removes it and focuses the previous one). |
| F-EDIT-13.5 | The section heading is editable and the section supports the same add / remove / reorder lifecycle as any other section (F-EDIT-12.1, F-EDIT-12.2). |
| F-EDIT-13.6 | The rendered chip order matches the model order; the emitted model reflects every edit (consistent with F-EDIT-12.4 / F-EDIT-8.4). |
| F-EDIT-13.7 | The generated PDF renders a Chip-list section's items as chips/tags (visually distinct from a bulleted List), preserving order. |

### 8.2 Technical Specification

#### Data model (extends §7.2)

`SectionTemplateId` gains `'chip-list'`. A new section interface is added; it
reuses the existing `ListItem` shape:

```ts
type SectionTemplateId = 'free-form' | 'timeline' | 'list' | 'chip-list';

interface ChipListSection extends SectionBase {
  template: 'chip-list';
  items: ListItem[];     // reuses { id, text } — rendered as chips, not bullets
}

type DocumentSection =
  | FreeFormSection | EntrySection | ListSection | ChipListSection;
```

The reference TypeScript lives in `apps/profile-builder-ui/src/model.ts`. The
mirror footprint was verified by inspecting each service; because `template` is
represented as a **plain string** in the proto and C# model, and `chip-list`
**reuses the existing `list` item shape** (`Items`/`Text`), the cross-service
change is small:

| File | Change | Why |
|---|---|---|
| `proto/llm_service.proto` | **None** | `DocumentSectionProto.template` is `string` — `chip-list` is just a new value. No `npm run grpc:generate` needed. |
| `apps/cv-api/Domain/Entities/ProfileDocument.cs` | Comment only | `Template` is a `string` and chip-list uses `Items[].Text`; deserialization works as-is. Update the `"free-form" \| "timeline" \| "list"` doc comments to include `"chip-list"`. |
| `apps/cv-api/Infrastructure/ExternalServices/Pdf/PdfService.cs` | **Add `case "chip-list"`** | The render switch (`free-form`/`timeline`/`list`, with a heading-only `default`) needs a chip/tag branch; otherwise chip-list would degrade to heading-only. |
| `apps/llm-service/app/schemas.py` | **Add to `Literal`** | `DocumentSection.template: Literal["free-form","timeline","list"]` is strict — must add `"chip-list"` or documents are rejected at validation. |
| `apps/llm-service/app/chains/cv_chain.py`, `chat_chain.py` | Prompt text | Serialization already handles item-based sections generically (the `else`/`list` branch), so it works; update the prompt's template descriptions so optimize/extract/chat can preserve and create chip-list sections. |
| `apps/llm-service/evals/evaluators.py` | **None** | Only counts `timeline` sections. |
| `apps/ui-angular/src/app/shared/models/profile.model.ts` | Add to union + `ChipListSection` interface | Keep the host's TS mirror accurate. |

> **No EF migration.** `Profile.Document` is a single JSON column (ADR-0013) and
> the discriminator is a string, not a DB-level enum — adding a template is a
> forward-compatible JSON change; existing rows are unaffected. (Verified against
> `ProfileDocument.cs` and the proto.)

#### profile-builder-ui (React)

| What | Where |
|---|---|
| Model + types | `src/model.ts` (`SectionTemplateId`, `ChipListSection`, `DocumentSection` union) |
| Template registry entry | `src/templates.ts` (`chipListTemplate`, added to `DEFAULT_SECTION_TEMPLATES`; reuse `newListItem`) |
| New component | `src/components/ChipListSection.tsx` — renders/edits chips (Enter = add, ×/Backspace = remove) |
| Render switch | `src/ProfileBuilder.tsx` — dispatch `template === 'chip-list'` to `ChipListSection` |
| Styles | `src/ProfileBuilder.css` — `.pb-chips` / `.pb-chip` (chip/tag styling, light + dark via CSS vars) |
| Content check | `src/util.ts` — `sectionHasContent` handles `chip-list` (any non-empty chip) |

#### Angular (host)

No new components or routes — the existing `<applysy-profile-builder>` embedding
at `/job-profiles/:id` passes the document through unchanged. Only the
`profile.model.ts` type mirror is updated so the host's typing stays accurate.

#### gRPC (llm-service)

The document is exchanged via `ProfileDocumentProto`. `DocumentSectionProto.template`
is a `string` field, so `chip-list` is just a new permitted value — **no proto
change and no `npm run grpc:generate`**. (Verified against `proto/llm_service.proto`.)

#### Out of scope (this change)

- Drag-to-reorder of individual chips (chips keep insertion order; sections still reorder).
- Per-chip metadata (color, level/proficiency, icons) — chips are plain text.
- Auto-suggest / taxonomy of skills.
- Migrating existing `list` sections to `chip-list` (users choose per section).

---

## 9. Versatile Widget Editor (US-EDIT-14 — ADR-0014)

> **Status:** Canonical (ADR-0014, amends ADR-0013). **Supersedes §7 and §8.**
> The profile body is no longer a flat `sections[]` array of single-template
> sections; it is a **rich-text block tree** edited in **one Lexical editor**
> over the whole document, built from a **closed set of predefined widgets**
> (`text`, `chips`, `list`, `timeline`) that **nest** within sensible limits.
> `ProfileDocument` changes from `{ header, sections[] }` to `{ header, body }`,
> and `body` is the canonical persisted/contract shape end to end (cv-api jsonb,
> gRPC, llm-service, PDF). The widget stays host-agnostic (no fetch/auth/routing);
> the host seeds `document` and listens for `documentchange`, unchanged.

### 9.1 Functional Requirements

#### Single-document canvas & sections

| # | Requirement |
|---|-------------|
| F-EDIT-14.1 | The profile body renders as **one continuous rich-text document** backed by a single editor instance — not a stack of independent per-section editors. The fixed `header` letterhead (§7.2) remains above it, outside the tree. |
| F-EDIT-14.2 | A user adds a section by inserting a **section** block with an editable heading; no template/type is chosen up front. An empty document and an empty section each show guidance prompting the user to start typing or insert a widget. |
| F-EDIT-14.3 | Sections are reorderable as whole blocks within the one document (drag handle + accessible move up/down fallback); reordering a section moves all of its descendant content with it. The rendered order always equals the tree order. |

#### Widgets & insertion

| # | Requirement |
|---|-------------|
| F-EDIT-14.4 | At the caret the user can insert any predefined widget — **text** (paragraph), **chips** (tag cloud), **list** (bullets), **timeline** (dated entries) — via an insertion affordance (e.g. a slash/"insert" menu). **Only** these widgets are available; there is no raw-HTML or arbitrary-node path. |
| F-EDIT-14.5 | Each widget keeps its editing affordances: **text** is free-form inline text; **chips** are short tag items added/removed inline; **list** is bulleted items edited document-style (Enter = new bullet, Backspace-at-start merges, Arrow Up/Down move) where each item is itself rich content; **timeline** holds dated **entries**, each with Title, a single free-text Dates field, and a rich-content Description. |
| F-EDIT-14.6 | Widgets **nest** inside the rich-content slots of other widgets per the nesting matrix (§9.3) — e.g. a list inside a section's text flow, a nested list inside a list item, a list inside a timeline entry's description. Nesting outside the matrix is not offered by the editor and is rejected on write. |
| F-EDIT-14.7 | Any widget and any section can be reordered and removed within its parent; removing a non-empty section/widget requires confirmation. Every structural node has a stable `id`. |
| F-EDIT-14.8 | The component reflects the supplied `body` tree on load and emits the updated tree on every change; live rendering and the generated CV reflect each node's type, nesting, and order. |

### 9.2 Document Model — the block tree

`ProfileDocument` becomes `{ header, body }`. `header` is unchanged (§7.2,
fixed identity/contact letterhead). `body` is a **`BlockNode` tree** — a plain,
JSON-safe, **editor-independent** shape (Lexical's own serialization is **not**
persisted; §9.4). The TypeScript definition in
`apps/profile-builder-ui/src/model.ts` is the reference; C# (`CvApi.Domain`) and
Python (`app/schemas.py`) mirror it.

```ts
interface ProfileDocument {
  header: ProfileHeader;   // unchanged fixed letterhead
  body: RootNode;          // single rich-text block tree
}

// Closed set of node types — no other `type` is valid, no raw HTML.
type NodeType =
  | 'root' | 'section'
  | 'paragraph' | 'text'
  | 'list' | 'listItem'
  | 'chips' | 'chip'
  | 'timeline' | 'entry';

interface BlockNode {
  type: NodeType;
  id: string;                 // stable, client-generated (reorder/diff/AI-patch key)
  attrs?: Record<string, string>;  // type-specific leaf data (see §9.3)
  children?: BlockNode[];     // ordered; array order IS document order
}

type RootNode      = BlockNode & { type: 'root';      children: SectionNode[] };
type SectionNode   = BlockNode & { type: 'section';   attrs: { heading: string }; children: FlowNode[] };
type FlowNode      = ParagraphNode | ListNode | ChipsNode | TimelineNode;
type ParagraphNode = BlockNode & { type: 'paragraph'; children: TextNode[] };
type TextNode      = BlockNode & { type: 'text';      attrs: { text: string } }; // marks deferred (§9.6)
type ListNode      = BlockNode & { type: 'list';      children: ListItemNode[] };
type ListItemNode  = BlockNode & { type: 'listItem';  children: (ParagraphNode | ListNode | ChipsNode)[] };
type ChipsNode     = BlockNode & { type: 'chips';     children: ChipNode[] };
type ChipNode      = BlockNode & { type: 'chip';      attrs: { text: string } };
type TimelineNode  = BlockNode & { type: 'timeline';  children: EntryNode[] };
type EntryNode     = BlockNode & { type: 'entry';     attrs: { title: string; dates: string };
                                   children: (ParagraphNode | ListNode)[] };  // rich description
```

`emptyDocument()` returns `{ header: emptyHeader(), body: { type:'root', id, children: [] } }`.

### 9.3 Node schema & nesting matrix (constrained, sensible)

A schema validator enforces the allowed children of each node. The editor cannot
author violations; cv-api rejects them on write; the PDF walk may assume them.

| Node | `attrs` | Allowed children | Notes |
|---|---|---|---|
| `root` | — | `section`* | top level is sections only |
| `section` | `heading` | `paragraph`, `list`, `chips`, `timeline` | a section is a flow of block widgets |
| `paragraph` | — | `text`* | inline text run(s); a "text block" |
| `text` | `text` | — | leaf; plain string (marks out of scope §9.6) |
| `list` | — | `listItem`* | bulleted list |
| `listItem` | — | `paragraph`, `list`, `chips` | rich item; **nested lists allowed**, no timeline inside a bullet |
| `chips` | — | `chip`* | tag cloud |
| `chip` | `text` | — | leaf; short string |
| `timeline` | — | `entry`* | dated entries |
| `entry` | `title`, `dates` | `paragraph`, `list` | Title + free-text Dates + rich Description; no timeline-in-entry |

Rejected nestings (examples): `timeline` inside `chips`/`chip`/`listItem`/`entry`;
`chips` inside `chip`; any node inside `text`/`chip`; non-`section` at `root`.
Max nesting depth is bounded (config; default 4 flow levels) so the PDF walk and
editor stay predictable.

### 9.4 Editor (Lexical) & serialization

- `apps/profile-builder-ui` is rebuilt on **Lexical** with custom nodes
  (`SectionNode`, `ChipsNode`/`ChipNode`, `TimelineNode`/`EntryNode`; `list`,
  `paragraph`, `text` reuse/extend Lexical built-ins) registered in a single
  editor configured with a **constrained node allow-list** matching §9.3.
- **One editor over the whole `body`.** Sections are Lexical block nodes with a
  drag handle and move controls; there are no separate per-section editors.
- A **serialization layer** maps Lexical `EditorState` ⇄ the neutral `BlockNode`
  tree (§9.2). **Round-trip fidelity is a hard requirement** (test in §Phase 3).
  Only the neutral tree crosses the web-component boundary
  (`document` prop/attr in, `documentchange` out) and the network — never
  Lexical's internal JSON.
- Insertion uses a slash/insert menu listing the four widgets; nesting offers are
  filtered to what the matrix permits at the caret.
- Theming, packaging (`<applysy-profile-builder>` custom element), and host I/O
  are unchanged from §7.3.

### 9.5 Cross-service Technical Specification

#### Data model (cv-api)

- `Profile.Document` JSON column shape changes `{ header, sections[] }` →
  `{ header, body }`. C# `ProfileDocument` gains `BlockNode body` (recursive
  record: `Type`, `Id`, `Attrs`, `Children`), drops `Sections`.
- **Validation on write:** the tree is checked against the §9.3 schema (closed
  type set, allowed children, depth bound) before persist; invalid → 400.
- **Migration (one-way, EF Core):** backfill each existing document —
  each old `section` → a `section` node; `free-form.body` → `paragraph`/`text`
  nodes; `list`/`chip-list.items` → `list`/`chips` nodes; `timeline.items` →
  `timeline`/`entry` nodes (Title/Dates → `attrs`, Description →
  `paragraph`). Rollback = restore from backup (ADR-0003).

#### API

`GET/PUT /api/job-profiles/:id` keep exchanging `{ id, name, document }`; only the
`document` shape changes (above). No route changes.

#### gRPC (`proto/llm_service.proto` — change + `npm run grpc:generate`)

Replace the section messages with a **recursive node** message:

```proto
message ProfileNode {
  string type = 1;
  string id = 2;
  map<string, string> attrs = 3;
  repeated ProfileNode children = 4;
}
message ProfileDocument {
  ProfileHeader header = 1;
  ProfileNode body = 2;   // root node
}
```

`Generate`, `ExtractProfile`, `Chat`, `SelectBestProfile` exchange
`ProfileDocument`. Chat proposals patch nodes by `id`. (`Optimize` also exchanged
documents but was removed — [ADR-0015](../../adr/0015-remove-optimize-enhance-endpoints.md).)

#### llm-service

- `app/schemas.py` gains the `BlockNode`/`ProfileDocument` Pydantic models;
  the extract chain returns a tree; chat patches nodes by `id`.
- Prompts describe the **node vocabulary and nesting rules** instead of fixed
  section templates.

#### PDF (cv-api renderer)

- Replace the per-template branch set with a **recursive tree walk**: one handler
  per node `type` (`section`→heading + block flow, `paragraph`→text run,
  `list`→bullets (indented for nesting), `chips`→tag row, `timeline`→entries).
  Unknown/empty nodes are skipped; depth is bounded per §9.3.

#### Angular host

- `/job-profiles/:id` keeps embedding `<applysy-profile-builder>`; it passes the
  new `document` shape through unchanged (host-agnostic boundary). No editor logic
  in Angular.

### 9.6 Out of Scope (this change)

- Rich-text **marks** (bold/italic/links) inside `text`/`chip` — `text.attrs.text`
  is plain for now; the node model leaves room to add marks later.
- Undo/redo beyond Lexical's built-in history, collaborative editing, auto-save.
- Tables, images, or any widget outside the four predefined types.
- Loosening the nesting matrix (§9.3) or unbounded depth.
- Date pickers/validation on `entry.dates` (free-text by design, per §7).

---

## 10. Controls Side Rail, Link Widget & Section Drag Preview (US-EDIT-15, US-EDIT-16)

### 10.1 Functional Requirements

| # | Requirement |
|---|-------------|
| F-EDIT-15.1 | A fixed vertical **controls side rail** renders beside the document sheet, always visible, listing all insertable widgets: **Title**, Text, Chips, List, Link, Timeline. Each item is **icon-only** (SVG icon styled after Google Docs toolbar icons); hovering (or focusing) it reveals a tooltip showing the widget **name and its keyboard shortcut**. |
| F-EDIT-15.2 | Clicking a widget control inserts it at the caret's section (or the last section as fallback), reusing the existing insert path. "+ Add section" appends a new section to the document end. |
| F-EDIT-15.3 | A control invalid at the current caret per the §9.3 matrix is rendered **disabled** (not removed), so the rail's shape is stable. |
| F-EDIT-15.4 | A new **Link** widget inserts a `link` node and round-trips through serialization, cv-api validation, and the generated PDF. |
| F-EDIT-15.5 | The rail is a labelled `role="toolbar"`, keyboard-operable (buttons), and screen-reader friendly: each icon button carries an accessible name (name + shortcut) and `aria-keyshortcuts`. |
| F-EDIT-15.6 | Each widget has a keyboard shortcut matching Google Docs conventions (mod = ⌘ on macOS, Ctrl elsewhere): Title `mod+Alt+1`, Text `mod+Alt+0`, List `mod+Shift+8`, Chips `mod+Shift+9`, Link `mod+K`, Timeline `mod+Shift+6`. The shortcut is shown in the hover tooltip and registered via `aria-keyshortcuts`. |
| F-EDIT-15.7 | When text is selected and the user inserts a **Link** (via the rail or `mod+K`), the selection is wrapped as an inline `LinkNode` rather than inserting a block link widget. A floating URL bar appears below the link; Enter or the ✓ button commits the URL and hides the bar; Escape discards changes and hides the bar; submitting an empty URL removes the link entirely. |
| F-EDIT-16.1 | Starting a section drag sets a **custom drag image** representing the dragged section (its heading), not the bare handle glyph. |
| F-EDIT-16.2 | While dragging over the rail, a **drop indicator** (a line between sections) shows where the section will land. |
| F-EDIT-16.3 | Dropping on a valid target reorders there; dropping elsewhere / pressing Esc cancels with no change. Drag is the sole reorder path; there are no move-up/move-down buttons. |

### 10.2 Technical Specification

**New node type — `link` (flow-level leaf).** Modeled as a standalone link line,
**not** an inline mark (inline marks stay out of scope per §9.6). Shape:
`{ type: 'link', id, attrs: { text, url } }`, no children.

Matrix changes (§9.3) — `link` is allowed wherever `paragraph` is:

- `ALLOWED_CHILDREN`: `section`, `listItem`, `entry` each gain `"link"`; add
  `link: []` (leaf).
- `REQUIRED_ATTRS`: `link: ['text', 'url']`.
- `link` does **not** introduce a flow level (it's a leaf).

Touched in all four mirrors of the closed type set:

- `apps/profile-builder-ui/src/model.ts` — `NodeType`, `LinkNode` alias,
  `ALLOWED_CHILDREN`, `REQUIRED_ATTRS`.
- `apps/profile-builder-ui/src/nodes.ts` — `linkNode()` factory + `WIDGETS`
  entry (`kind: 'link'`).
- `apps/profile-builder-ui/src/lexical/widget-nodes.ts` — a `LinkWidgetNode`
  (DecoratorNode) carrying `{text,url}` + `$createLinkNode`/`$isLinkNode`.
- `apps/profile-builder-ui/src/serialize.ts` — both directions.
- `apps/cv-api/Domain/Entities/ProfileDocumentSchema.cs` — `AllowedChildren` +
  required-attrs parity.
- `apps/cv-api/Infrastructure/ExternalServices/Pdf/PdfService.cs` — `case "link"`
  render (text as a hyperlink to `url`); add `link` to the listItem/entry block
  switches and the "is flow block" predicate.
- `apps/llm-service/app/schemas.py` — `ALLOWED_CHILDREN` + `REQUIRED_ATTRS`.

No gRPC/proto change: `ProfileNode` is already a generic recursive
`{type,id,attrs,children}`. No DB migration: body is stored as opaque jsonb.

**Controls side rail.** Rendered **inside the profile-builder-ui web component**
(it needs editor/caret access via `useLexicalComposerContext`), replacing the
current top `InsertToolbar`. Layout: a sticky column in the left gutter of
`.pb-root`. Each widget button calls the existing `insertWidget`; validity
(F-EDIT-15.3) is computed from `widgetsAllowedIn` for the caret's container.
Adding a section is a separate `AddSectionButton` rendered at the end of the
`.pb-sheet` (a section always appends to root).

Buttons are **icon-only** (`.pb-rail__icon`); the name and shortcut live in a
CSS hover/focus tooltip (`.pb-rail__tip` + `.pb-rail__tip-key`) anchored to the
right of the icon, and in each button's `aria-label`/`aria-keyshortcuts`.
Shortcuts (F-EDIT-15.6) are registered once via a Lexical `KEY_DOWN_COMMAND`
handler matching `event.code` (`Digit1`…`Digit5`) with the platform modifier
(`metaKey` on macOS, else `ctrlKey`) + `shiftKey`; a match inserts the widget at
the caret's section and is a no-op when no section exists.

**Section drag preview.** In `SectionControls`, a **pointer-based** drag
(mousedown/mousemove/mouseup), not native HTML5 DnD — native DnD is unreliable
for this web component embedded in a host's light DOM and cannot be driven by
automated tests (neither Playwright `dragTo` nor `page.mouse` triggers the native
drag pipeline):

- `onMouseDown` on the handle captures the section key and shows a fixed-position
  floating ghost (`.pb-drag-ghost`) labelled with the heading (F-EDIT-16.1);
  window-level `mousemove`/`mouseup` listeners continue the drag outside the
  gutter.
- `mousemove` maps the pointer Y (via `sectionAt`) to the target section across
  the whole document band — not just the gutter handle — and positions the
  `.pb-drop-line` indicator (F-EDIT-16.2). The line is **centred in the
  inter-section gap** (midpoint between the target and its neighbour), never
  flush against a section's edge where it would read as "inside" the section; at
  the document start/end it nudges just outside the first/last section.
- `mouseup` reorders relative to the target (insert before/after by index) and
  clears the ghost/indicator; a drop on the source section is a no-op.

### 10.3 Out of Scope (this change)

- ~~Inline links inside running text~~ — **now in scope** (F-EDIT-15.7); the original §9.6 out-of-scope note is superseded.
- Drag-to-insert from the rail (insertion is click-at-caret only).
- Reordering non-section widgets via drag (covered separately).
- Link URL validation beyond non-empty / basic `href` safety.

## 11. Empty-region Affordances (US-EDIT-17)

### 11.1 Functional Requirements

| # | Requirement |
|---|-------------|
| F-EDIT-17.1 | An empty editable **structural field** (section heading, timeline entry title, entry dates) renders a subtle tinted, dashed **slot** plus its placeholder text, so the field is visible even when it holds no text. |
| F-EDIT-17.2 | A genuinely **empty section body** (its last/only flow child is an empty paragraph) renders a full-width slot with the hint *"Empty section — type here, or insert a widget from the rail"*. |
| F-EDIT-17.3 | An **empty timeline entry description** renders a full-width slot with a *"Describe it — …"* hint, so an inserted timeline reads as fillable rather than blank. |
| F-EDIT-17.4 | All markers disappear as soon as the region has content; sections/fields with content show no marker (clean résumé output). |
| F-EDIT-17.5 | A timeline entry's subsections (title, dates, description) are **required and non-removable**: editing may clear a field's text but must not delete or merge the field/line. Backspace at the start — or Delete at the end — of an entry subsection is a no-op; ordinary mid-text editing is unaffected. The entry always round-trips with its title/dates/description structure. |

### 11.2 Technical Specification

CSS-only, in `ProfileBuilder.css`. The key constraint: Lexical keeps an **empty
text span** (`<span data-lexical-text>` with no text) inside an "empty" editable
element, so `:empty` does **not** match it and the prior placeholder rules never
fired. Emptiness is detected with `:has(> span[data-lexical-text]:empty)` (the
truly-childless `:empty` case is kept too).

- Fields (`[data-pb='section-heading'|'entry-title'|'entry-dates']`): slot fill
  `--pb-slot` + inset `--pb-slot-border` ring; placeholder via `::before` =
  `attr(data-placeholder)`.
- Flow paragraphs: scoped to the **last** direct child of `[data-pb='entry']` /
  `[data-pb='section']` (`:last-child:has(> span:empty)`) so the hint marks a
  genuinely empty region and clears once a widget/more content follows; hint text
  is a literal `content:` string per context.
- New theme tokens `--pb-slot` / `--pb-slot-border` (light + dark).

Requires `:has()` (supported in the embedded modern-Chromium host). Behaviour is
verified in the browser (the `:has()`/`::before` empty-state styling is not
expressible in jsdom), consistent with the other browser-verified editor paths.

**Entry subsection guard (F-EDIT-17.5).** Two pieces, both in the editor:

- `EntryFieldNode.collapseAtStart()` returns `false` (widget-nodes.ts) — Lexical
  won't merge/remove a title/dates line on a start-of-line Backspace.
- An `EntryStructureGuardPlugin` (ProfileBuilder.tsx) registers
  `KEY_BACKSPACE_COMMAND` / `KEY_DELETE_COMMAND` at `COMMAND_PRIORITY_HIGH`. When
  the collapsed caret sits on a subsection boundary — the very start (Backspace)
  or very end (Delete) of a block that is a direct child of an `EntryNode` — it
  consumes the event so the destructive merge/delete never runs. Offsets inside a
  field fall through to normal editing.

Verified by Playwright (`e2e/timeline-entry.spec.ts`) with real keypresses and
caret placement synced to Lexical, asserting on the serialized `document`.

### 11.3 Out of Scope (this change)

- An explicit **"Add entry"** button for timelines (adding further entries) —
  separate follow-up; this change only makes the existing entry's fields visible
  and keeps an entry's subsections from being deleted (F-EDIT-17.5).
- Per-widget empty states beyond sections, timelines, and their fields.
- Range-selection deletions that span multiple subsections (the guard covers the
  collapsed-caret Backspace/Delete merge paths, which are the accidental ones).

---

## 12. Remove Section Button (US-EDIT-18)

### 12.1 Functional Requirements

| # | Requirement |
|---|-------------|
| F-EDIT-18.1 | Each section renders a ✕ **remove button** in the left gutter rail, vertically aligned with the section heading row. |
| F-EDIT-18.2 | The button is styled consistently with the timeline-entry remove button (`.pb-remove-entry`): same size, glyph, and gutter-positioning convention. |
| F-EDIT-18.3 | Clicking ✕ removes the section immediately — no confirmation, regardless of content. Undo via Ctrl/⌘+Z restores it through Lexical's built-in history. |
| F-EDIT-18.4 | The button carries `aria-label="Remove section"` for screen-reader accessibility. |

### 12.2 Technical Specification

All work is inside `apps/profile-builder-ui`.

**`RemoveSectionButtons` component** (`ProfileBuilder.tsx`) — mirrors `RemoveEntryButtons`. Renders one positioned ✕ button per section; positions are derived from the section heading element's vertical centre via `registerUpdateListener` + `ResizeObserver`. `removeSection(key)` calls `editor.update(() => $getNodeByKey(key)?.remove())`.

**Styles** (`ProfileBuilder.css`) — `.pb-remove-section` mirrors `.pb-remove-entry`: `position: absolute`, left-gutter offset aligned with the heading row.

### 12.3 Out of Scope

- Confirmation dialogs — removal is immediate and reversible via undo.
- Bulk-remove or drag-to-trash.

## 12. Remove Section Button (US-EDIT-18)

### 12.1 Functional Requirements

| # | Requirement |
|---|-------------|
| F-EDIT-18.1 | Each section in the document renders a ✕ **remove button** in the left gutter rail, vertically aligned with the section heading row. |
| F-EDIT-18.2 | The button is styled consistently with the timeline-entry remove button (`.pb-remove-entry`): same size, same glyph, same positioning convention. |
| F-EDIT-18.3 | Clicking ✕ on an **empty** section (all flow children have no text content) removes it immediately without confirmation. |
| F-EDIT-18.4 | Clicking ✕ on a **non-empty** section shows a `window.confirm` prompt — *"Remove this section and all its content?"*. The section is removed only if the user confirms; cancelling leaves it untouched. |
| F-EDIT-18.5 | The button carries `aria-label="Remove section"` for screen-reader accessibility. |

### 12.2 Technical Specification

All work is inside `apps/profile-builder-ui`.

**`SectionControls` component** (`ProfileBuilder.tsx`) — add a remove button to each section handle group. Positions track the section heading DOM element (same `registerUpdateListener` + `ResizeObserver` loop already used for the move/drag handles). A section is considered empty when every flow child's `getTextContent()` is `''`.

**`removeSection(key)`** — `editor.update()` call: `$getNodeByKey(key).remove()`.

**Styles** (`ProfileBuilder.css`) — `.pb-remove-section` mirrors `.pb-remove-entry`: `position: absolute`, left-gutter offset, small `×` icon button; hover state consistent with existing gutter controls.

### 12.3 Out of Scope

- Undo after section removal (covered by Lexical's built-in history plugin).
- Bulk-remove or drag-to-trash.
- Custom confirmation dialog UI (plain `window.confirm` is sufficient for now).

---

## 13. Title-Anchored Document Sections (US-EDIT-19)

### 13.1 Functional Requirements

| # | Requirement |
|---|-------------|
| F-EDIT-19.1 | The `section` node type is retired. The document body (`RootNode.children`) is now a flat ordered list of `title`, `paragraph`, `chips`, `list`, `timeline`, and `link` nodes. |
| F-EDIT-19.2 | A `title` node is a leaf with a single required attr `text` (the heading string). It renders as a bold heading line in the editor. |
| F-EDIT-19.3 | The controls rail includes a **Title** entry; clicking it inserts a new `title` node at the current caret position (or appends to the end if no caret). |
| F-EDIT-19.4 | Dragging the drag handle on a `title` node moves the title **and all consecutive non-title nodes that follow it** (its "group") as a single unit, inserting the whole group before or after the target `title` group. |
| F-EDIT-19.5 | ~~Move-up / move-down buttons~~ — **removed**. Drag via the handle is the sole reorder path (see F-EDIT-19.4). |
| F-EDIT-19.6 | The drag handle is only shown for `title` nodes (appears on hover over the title); individual non-title blocks at the root have no reorder controls. |
| F-EDIT-19.9 | Pressing **Enter** while the caret is inside a `title` node inserts an empty `paragraph` node immediately after the title and moves the caret into it, letting the user start typing content below the heading without reaching for the rail. |
| F-EDIT-19.7 | The `title` node round-trips faithfully through `serialize.ts` (BlockNode ↔ Lexical) and through the network (cv-api JSON column, gRPC proto, PDF rendering). |
| F-EDIT-19.8 | On load, documents containing `section` nodes are **migrated in-memory**: each `section` is converted to a `title` node (attrs `text` = `section.attrs.heading`) followed by the section's former flow children, all appended flat to root. The migration runs client-side in `loadDocument` / `$writeBody`; the neutral tree emitted by `onChange` is already in the new flat shape. |

### 13.2 Technical Specification

All work is inside `apps/profile-builder-ui` unless noted.

#### 13.2.1 Data model (`model.ts`)

- Add `'title'` to `NodeType`.
- Remove `'section'` from `NodeType` and from `ALLOWED_CHILDREN`.
- Add `ALLOWED_CHILDREN.title = []` (leaf — no children).
- Add `ALLOWED_CHILDREN.root` entry: `['title', 'paragraph', 'list', 'chips', 'timeline', 'link']`.
- Add `REQUIRED_ATTRS.title = ['text']`.
- Add type alias: `export type TitleNode = BlockNode & { type: 'title'; attrs: { text: string } }`.
- Update `RootNode`: `children: (TitleNode | FlowNode)[]`.
- Update `FlowNode` union to remove all section references (it no longer exists at root).
- Remove `SectionNode` type alias and all references to it.
- Update `validateDocument` `FLOW_CONTAINERS`: remove `'section'` if present.

#### 13.2.2 Node factory (`nodes.ts`)

- Add `titleNode(text = 'Section heading'): TitleNode`.
- Remove `sectionNode`.
- Update `rootNode` signature to accept `(TitleNode | FlowNode)[]`.
- Add `title` to `WidgetKind` union and to `WIDGETS` array (name: `'Title'`, description: `'A section heading that groups the content below it.'`, make: `() => titleNode()`).
- Remove `timeline` widget's dependency on `SectionNode`; update `widgetsAllowedIn` — root now allows `title`.

#### 13.2.3 Lexical node (`lexical/widget-nodes.ts`)

- Add `PbTitleNode extends ElementNode` (or `DecoratorNode` if inline editing is simpler):
  - Serializes to/from `{ type: 'title', id, attrs: { text } }`.
  - `createDOM` returns a `<h2 data-pb="title">` element styled via CSS class `pb-title`.
  - Stores the heading text as a single child `PbTextNode` so it is editable in-line (same pattern as `SectionHeadingNode`).
  - `getNodeId()` returns the stable neutral id.
- Export `$createTitleNode(id?, text?)`, `$isTitleNode`.
- Remove `SectionNode`, `SectionHeadingNode`, `$createSectionNode`, `$createSectionHeadingNode`, `$isSectionNode`, `$isSectionHeadingNode` (or keep as deprecated stubs for migration only).
- Add `PbTitleNode` to the `WIDGET_NODES` export array.

#### 13.2.4 Serialization (`serialize.ts`)

**BlockNode → Lexical (`$createLexicalNode`)**

- Add `case 'title'`: create a `PbTitleNode`, append a `PbTextNode` with `node.attrs.text`.
- Add `case 'section'` (migration path): convert to a `PbTitleNode` (heading = `node.attrs.heading`) followed by the section's children appended directly to the parent root — handled in `$writeBody` (see below).
- Remove the old `case 'section'` that produced a `SectionNode`.

**`$writeBody`**

- Iterate `body.children`; for each child:
  - If `type === 'title'` → `$createLexicalNode(child)`, append to root.
  - If `type === 'section'` (legacy) → create a `PbTitleNode` from `attrs.heading`, then create Lexical nodes for each of `child.children` and append them all to root (flattening the section).
  - Otherwise → `$createLexicalNode(child)`, append to root.

**Lexical → BlockNode (`readLexicalNode` / `$readBody`)**

- Add handler for `$isTitleNode`: emit `{ type: 'title', id, attrs: { text } }`.
- Remove handler for `$isSectionNode`.
- `$readBody`: collect **all** root children (not only sections); emit them into `children` as a flat array. The `children` type becomes `(TitleNode | FlowNode)[]`.

#### 13.2.5 Editor UI (`ProfileBuilder.tsx`)

**Drag-group helpers**

```
// Returns all root nodes that belong to the same title group as `key`:
// the title node at `key` plus all consecutive non-title siblings that follow it.
function titleGroupKeys(editor, titleKey): string[]

// Given a clientY, resolve the drop target: the title node (key) whose group
// the pointer is over, and whether the whole group lands before or after it.
function dropGroupTargetAt(clientY, handles): { key: string; place: 'before'|'after'; lineY: number } | null
```

**`TitleControls` component** (replaces `SectionControls`)

- Renders one gutter group per `title` node (drag handle + ▲ ▼ + ✕).
- Positions track the `PbTitleNode`'s DOM element top (same `registerUpdateListener` + `ResizeObserver` pattern).
- `moveGroup(key, dir)` — collect the group's keys, find the adjacent title group in direction `dir`, and insert the whole group before/after it in one `editor.update` call.
- `reorderGroup(sourceKey, place, targetKey)` — collect source group keys, insert them before/after the target title node in one `editor.update` call.
- `removeTitle(key)` — removes only the title node itself (not its group); group content stays in place.
- Drag ghost: clone the group's DOM elements (all group nodes' `outerHTML` concatenated) for the floating preview.
- Drop line: drawn between title groups, not between individual blocks.

**`ControlRail`**

- `hasSection` check becomes `hasTitle` (or removed entirely — widgets can always be inserted at root now).
- Add `title` widget button to the rail.

**`EntryStructureGuardPlugin`**

- Remove `$isSectionNode` / `$isSectionHeadingNode` branches; the title node's text is guarded the same way as the section heading was (block the structural-boundary backspace/delete for `PbTitleNode`'s text child).

**`AddSectionButton`** → rename to `AddTitleButton` or remove (if the rail covers it).

**`RemoveSectionButtons`** → remove (now part of `TitleControls`).

#### 13.2.6 Styles (`ProfileBuilder.css`)

- Add `.pb-title` — bold heading, same visual weight as the former `.pb-section__heading`.
- Remove `.pb-section`, `.pb-section__heading` (or keep as tombstones with a comment).
- Update `.pb-section-rail` → `.pb-title-rail` (or keep class name if reuse is cleaner).

#### 13.2.7 Back-end sync

**`apps/cv-api/Domain/Entities/ProfileDocumentSchema.cs`**

- Add `"title"` to the allowed node-type enum / discriminator.
- Remove `"section"` (or keep for read-only legacy migration).
- Update the required-attrs table: `title` requires `text`.
- Update the nesting matrix: `root` children now include `title`.

**`apps/llm-service/app/schemas.py`**

- Add `'title'` to the `NodeType` literal / enum.
- Remove `'section'` (or keep as deprecated).
- Mirror the `ALLOWED_CHILDREN` matrix changes.

**`apps/cv-api/Infrastructure/ExternalServices/Pdf/PdfService.cs`**

- Add rendering for `title` node: output a bold heading element (same as the former section heading).
- Remove rendering for `section` (or keep as fallback for stored legacy documents).

#### 13.2.8 Migration strategy

The migration is **client-side and lazy**: `$writeBody` converts any `section` node it encounters into a flat title + children. The neutral tree emitted by `onChange` is already in the new shape, so the first save after opening a legacy document transparently upgrades it. No server-side migration or database schema change is required.

### 13.3 Out of Scope

- Server-side bulk migration of stored documents.
- Drag reordering of individual non-title root blocks (they have no drag handle).
- Nested titles (a `title` is always a root-level node; it cannot appear inside a timeline entry or list).

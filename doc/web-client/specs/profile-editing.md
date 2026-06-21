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
> `GET/PUT /api/job-profiles/:id` exchange `{ id, name, document }`, optimize /
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

`Generate`, `Optimize`, `ExtractProfile`, `Chat`, `SelectBestProfile` exchange
`ProfileDocument`. Chat proposals patch nodes by `id`.

#### llm-service

- `app/schemas.py` gains the `BlockNode`/`ProfileDocument` Pydantic models;
  extract/optimize chains return a tree; chat patches nodes by `id`.
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

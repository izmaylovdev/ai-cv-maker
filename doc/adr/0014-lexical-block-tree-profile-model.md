# ADR-0014: Lexical rich-text block tree as the canonical profile body

- **Status:** Accepted
- **Date:** 2026-06-21
- **Amends:** [ADR-0013](0013-canonical-profile-document-model.md) (still
  Accepted; this ADR changes the *body* representation it introduced, not the
  decision to make a single profile document canonical end to end).

## Context

ADR-0013 made a section-based `ProfileDocument { header, sections[] }` the
canonical profile model. Each section is bound to exactly one `template`
(`free-form` | `timeline` | `list` | `chip-list`) and the builder switches on
that discriminant to pick an editor. In practice this is too rigid:

- A section can only ever be *one* kind of content. A user who wants a paragraph
  of context followed by a bulleted list, or a list nested under a timeline
  entry's description, cannot express it.
- "Template" is a structural decision forced *before* the user writes anything,
  and the "Add section" palette exists only to make that choice.
- The content shapes (`body` string, `items[]`, `EntryItem[]`) are four
  unrelated leaf shapes; there is no composition between them.

The product direction (US-EDIT-14) is the opposite: **one versatile rich-text
editor** over a **closed set of predefined widgets** — `text`, `chips`, `list`,
`timeline` — where widgets can **nest** inside the rich content of other widgets
(a list inside a paragraph, a list inside a timeline entry's description), and
where the *whole profile body is a single document* with sections as reorderable
structural blocks rather than separate editors.

That is a structured-document tree, which is what ProseMirror/Lexical exist to
manage. We evaluated building it by hand and on both frameworks (see
Alternatives) and chose **Lexical** for the editor. The open question this ADR
settles is the **canonical persisted/contract shape**: Lexical's own serialized
JSON, or a normalized neutral tree the editor maps to and from.

## Decision

We will represent the profile body as a **normalized neutral block tree** and
make it the canonical shape across all services, edited in the UI by a **single
Lexical editor instance**.

- **Model.** A profile is `{ header, body }`.
  - `header` is unchanged from ADR-0013 (identity/contact: `fullName`, `title`,
    `email`, `phone`, `location`) — it remains fixed and outside the rich-text
    tree.
  - `body` is a **`BlockNode` tree**. Every node is
    `{ type, id, attrs?, children? }`:
    - `type` is from a **closed set**: `root`, `section`, `paragraph`, `text`,
      `chips`, `chip`, `list`, `listItem`, `timeline`, `entry`. No other types
      are valid; there is no raw-HTML escape hatch.
    - `id` is a stable client-generated id (reorder/diff/AI-patch target).
    - `attrs` holds type-specific leaf data (e.g. `text.attrs.text`,
      `section.attrs.heading`, `entry.attrs.dates`).
    - `children` holds ordered child nodes; **node order is document order.**
  - **Sections are `section` nodes** under `root` (heading in `attrs`, content in
    `children`). Reordering a section reorders its node — there is no separate
    section list or order field.
- **Nesting (constrained, not arbitrary).** A schema fixes which node types may
  be children of which (the matrix lives in the spec). The intent: rich-content
  slots (`section`, `paragraph`, `listItem`, `entry` description) accept text and
  structural widgets; leaf-ish widgets (`chips`, `timeline` dates) do not accept
  arbitrary nesting. Validation rejects trees that violate the schema on the way
  in (cv-api) and the editor cannot produce them.
- **Editor (UI).** `apps/profile-builder-ui` is rebuilt on **Lexical** with
  custom nodes for our widgets. There is **one editor over the whole body**, not
  one per section. A serialization layer maps Lexical's `EditorState` ⇄ the
  neutral `BlockNode` tree; **Lexical's own JSON is never persisted or sent over
  the wire** — only the neutral tree crosses the component boundary
  (`onChange`/`document` prop) and the network.
- **Persistence (cv-api).** `Profile.Document` stays a single JSON column; its
  shape changes from `{ header, sections[] }` to `{ header, body }`. A migration
  backfills existing documents: each old section becomes a `section` node and its
  template content becomes the equivalent widget subtree (`free-form` →
  `paragraph`s; `list` → `list`; `chip-list` → `chips`; `timeline` → `timeline`
  of `entry`s). cv-api validates the tree against the schema on write.
- **gRPC contract.** `proto/llm_service.proto` replaces the section messages with
  a **recursive `ProfileNode`** message (`type`, `id`, map/struct `attrs`,
  repeated `ProfileNode children`) plus the unchanged `header`. `Generate`,
  `Optimize`, `ExtractProfile`, `Chat`, and `SelectBestProfile` speak the tree.
- **llm-service.** Chains read and emit the `BlockNode` tree; extract/optimize
  return a tree, chat proposals patch nodes by `id`.
- **PDF.** The renderer becomes a **recursive tree walk** (one handler per node
  `type`) instead of the per-template branch set; unknown/empty nodes degrade
  gracefully.

The TypeScript `BlockNode`/`ProfileDocument` in
`apps/profile-builder-ui/src/model.ts` remains the reference definition; C#
(`CvApi.Domain`) and Python (`app/schemas.py`) mirror it.

## Alternatives considered

- **Persist Lexical's own serialized JSON as canonical.** Cheapest in the UI (no
  mapping layer). Rejected: it couples cv-api, the gRPC contract, llm-service,
  and the PDF renderer to Lexical's internal node format and `version` fields,
  which the library may change; every backend would track a frontend editor
  library's schema, and swapping the editor later would be a data migration. The
  neutral tree costs one mapping layer in the UI to keep storage/contract/PDF
  independent of the editor — a good trade for a shape four services depend on.
- **Keep ADR-0013's flat section templates, just add more templates.** Rejected:
  it never allows composition (a paragraph *and* a list in one section, nesting),
  which is the core of US-EDIT-14; adding templates only multiplies rigid types.
- **Build the nested editor by hand (custom contenteditable + own tree).** No
  dependency and full control of the model. Rejected: nested-contenteditable
  selection, caret, keyboard, and copy/paste are notoriously hard to get right;
  Lexical solves exactly this and still lets us constrain the schema to our
  widgets and serialize to our neutral tree.
- **ProseMirror/TipTap instead of Lexical.** A close call; both fit a constrained
  schema with JSON output. Chose Lexical for its React-first API and lighter
  integration in the embedded web component. The canonical shape is the neutral
  tree either way, so the editor choice stays reversible.
- **One Lexical editor per section (sections as separate instances).** Rejected
  per the product refinement: it fragments selection/clipboard across editors and
  makes cross-section editing and a single document feel awkward; one editor with
  `section` nodes gives easy reorder and a true single document.

## Consequences

- **Easier:** content composes freely (mixed/nested widgets) within a single
  document; new widget types are additive to the schema and flow to AI and PDF as
  generic nodes; reorder is just node movement; storage/contract/PDF are
  insulated from the editor library by the neutral tree.
- **Harder / new obligations:**
  - A **schema + validator** for the node tree and its nesting matrix must exist
    in the UI (authoring), cv-api (write validation), and be respected by the PDF
    walk; the three must agree. The TS model stays the reference.
  - A **serialization layer** (Lexical `EditorState` ⇄ `BlockNode`) is new code
    with its own tests; round-trip fidelity is a hard requirement.
  - The **gRPC `ProfileNode` is recursive**; generated code and llm-service must
    handle arbitrary-depth trees, and prompts must describe the node vocabulary
    instead of fixed sections.
  - A **one-way backfill migration** from `{header,sections[]}` to `{header,body}`
    (rollback = restore from backup, per ADR-0003).
  - PDF layout is now driven by an arbitrary nested tree; it must bound depth and
    degrade gracefully for unknown/empty nodes.
- **Revisit if:** the neutral-tree mapping proves to drift from Lexical's
  capabilities often enough to be a tax (then reconsider persisting Lexical JSON
  behind a versioned adapter), or if constrained nesting blocks a real user need
  (loosen the matrix rather than allow raw HTML).

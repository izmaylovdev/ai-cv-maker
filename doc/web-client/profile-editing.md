# Profile Editing

The profile editor is a document-style canvas: a fixed letterhead plus one
continuous rich-text document built from a closed set of widgets. It is not a
form. Users compose a CV the way they would in a word processor, and the same
tree is what gets persisted, sent to the LLM, and rendered to PDF.

**Code:** `apps/profile-builder-ui` (React web component `<applysy-profile-builder>`),
hosted by `apps/ui-angular/src/app/features/profile/`
**See also:** [ADR-0013](../adr/0013-canonical-profile-document-model.md) (document model) ·
[ADR-0014](../adr/0014-lexical-block-tree-profile-model.md) (block tree, supersedes per-section templates) ·
[job-profiles.md](job-profiles.md) · [chat.md](chat.md) · [cv-generation.md](cv-generation.md)

---

## What a user can do

**Edit the letterhead.** Full name, professional title, email, phone, and
location sit above the document as a fixed header. It cannot be added, removed,
or reordered — every CV needs it and the PDF renderer depends on it.

**Write the body as one document.** A single editor instance backs the whole
body. Headings are `title` nodes; a title plus every non-title node after it
forms a "group" that behaves as a section. Rendered order always equals tree
order.

**Insert widgets from the controls rail.** A fixed vertical rail beside the sheet
lists every insertable widget as an icon-only button with a tooltip showing its
name and shortcut. Widgets invalid at the caret are shown **disabled** rather than
hidden, so the rail's shape never moves.

| Widget | Shortcut (mod = ⌘ on macOS, Ctrl elsewhere) | What it is |
|---|---|---|
| Title | `mod+Alt+1` | Bold heading line; anchors the group below it |
| Text | `mod+Alt+0` | Free-form paragraph |
| List | `mod+Shift+8` | Bulleted list; items hold rich content and nest |
| Chips | `mod+Shift+9` | Tag cloud of short items |
| Link | `mod+K` | Inline hyperlink at the caret or around the selection |
| Timeline | `mod+Shift+6` | Dated entries (role, study, project) |

The rail is a labelled `role="toolbar"`; every button carries an accessible name
and `aria-keyshortcuts`.

**Insertion follows the caret.** With the caret inside a timeline entry,
inserting List, Link, or Chips places the node *inside that entry*, right after
the block holding the caret — and the rail narrows to the widgets valid there
(`text`, `list`, `link`, `chips`); Title and Timeline are not offered and their
hotkeys are no-ops. Outside an entry, insertion anchors at root level.

**Timeline entries** hold a Title, a single free-text Dates field, and a rich
description. Those three subsections are required and non-removable: editing can
clear a field's text but Backspace at the start or Delete at the end of a
subsection is a no-op, so an entry never collapses or merges into its neighbour.

**Links** come in two shapes. `mod+K` or the rail produces an **inline** link —
wrapping the selection, or inserted at the caret with the label mirroring the URL
until the user types their own. A floating editor below the link offers a **Link
text** and a **Link URL** field: committing sets the label to `text || url`, so a
link is never invisible; committing an empty URL removes the link; Escape leaves
both as they were. After a ✓ commit the caret sits *after* the link, so typing
continues the running text instead of extending the label. A standalone block
`link` line also remains valid in the model, for back-compat and AI-authored
content.

**Empty regions are visible.** Empty structural fields (title text, entry title,
entry dates) render as a tinted dashed slot with placeholder text. An empty
document region shows "type here, or insert a widget from the rail"; an empty
entry description shows a "Describe it — …" hint. Every marker disappears the
moment the region has content, so a finished CV is clean.

**Pasting into a single-line field** (a title, entry title, or dates) flattens
the clipboard to one line of plain text inside that field — rich or
multi-paragraph content never spills out as sibling blocks or splits an entry.
Pasting into a description or other flow region keeps its block structure.

**Reordering and removal.** Dragging a title's handle moves the title *and its
whole group* as a unit; a custom drag image shows the heading being dragged and a
drop-indicator line shows where it will land. Dropping outside a valid target, or
pressing Escape, cancels. Drag is the only reorder path — there are no
move-up/move-down buttons, and non-title blocks at root have no handle. A ✕ button
in the left gutter removes a title's section immediately, with no confirmation;
⌘/Ctrl+Z restores it through the editor's history.

**Enter inside a title** creates an empty paragraph directly below and moves the
caret into it.

**Saving is explicit.** Edits live in the host component as they happen; the Save
button PUTs the whole document and shows "Profile saved successfully!" or a
failure toast. Unsaved edits are what the PDF preview and the in-editor chat
operate on, so what the user sees is what gets rendered or reasoned about.

---

## Document model

`ProfileDocument` is `{ header, body }`. `header` is the fixed letterhead
(`fullName`, `title`, `email`, `phone`, `location`). `body` is a `RootNode` — a
plain, JSON-safe, **editor-independent** block tree. Lexical's own serialization
is never persisted.

`apps/profile-builder-ui/src/model.ts` is the reference definition;
`apps/cv-api/Domain/Entities/ProfileDocumentSchema.cs` and
`apps/llm-service/app/schemas.py` mirror it. All three must change together.

Every node is `{ type, id, attrs?, children? }` with a stable client-generated
`id` (the key for reordering, diffing, and AI patches). Array order *is* document
order.

| Node | Required `attrs` | Allowed children |
|---|---|---|
| `root` | — | `title`, `paragraph`, `list`, `chips`, `timeline`, `link` |
| `title` | `text` | — (leaf) |
| `paragraph` | — | `text`, `inlineLink` |
| `text` | `text` | — (leaf) |
| `inlineLink` | `text`, `url` | — (leaf) |
| `link` | `text`, `url` | — (leaf, standalone block line) |
| `list` | — | `listItem` |
| `listItem` | — | `paragraph`, `list`, `chips`, `link` |
| `chips` | — | `chip` |
| `chip` | `text` | — (leaf) |
| `timeline` | — | `entry` |
| `entry` | `title`, `dates` | `paragraph`, `list`, `chips`, `link` |

Nesting outside this matrix is rejected: the editor cannot author it, cv-api
refuses it on write, and the PDF walk may assume it. Flow nesting depth is
bounded (default 4; `list` and `timeline` are the depth-incrementing containers —
`entry` is not).

The body is a **flat, title-anchored** list. The old `section` node type is
retired; documents that still contain `section` nodes are migrated in memory on
load — each section becomes a `title` node carrying its heading, followed by the
section's former children, appended flat to root. Everything emitted by the
editor is already in the flat shape.

---

## Contract with the host

The web component stays host-agnostic — no fetch, no auth, no routing. The
Angular host seeds the `document` property and listens for `documentchange`; the
component reflects the supplied tree on load and emits the updated tree on every
change. Validation lives in three places against the same matrix: the editor
(cannot author violations), cv-api (`400 { error }` on write), and llm-service
(rejects malformed LLM output).

---

## Not implemented

Text marks other than links (bold, italic, colour), raw-HTML or arbitrary-node
insertion, per-widget styling, collaborative editing, and an unsaved-changes
navigation guard. Reordering individual non-title blocks at root has no UI
affordance — move the group, or cut and re-insert.

> **History.** This feature has been rebuilt twice. The original form-based editor
> (personal-info form, work/education entry lists, skills, section-order
> drag-and-drop, live preview pane) was replaced by the canonical document model
> in ADR-0013, whose per-section template array was in turn replaced by the single
> block tree in ADR-0014. Both ADRs record the reasoning.

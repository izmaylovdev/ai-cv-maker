# Profile Editing

The profile editor is a document-style canvas: a fixed letterhead plus one
continuous rich-text document built from a closed set of widgets. It is not a
form. Users compose a CV the way they would in a word processor, and the same
tree is what gets persisted, sent to the LLM, and rendered to PDF.

**Code:** `apps/profile-builder-ui` (React web component `<applysy-profile-builder>`),
hosted by `apps/ui-angular/src/app/features/profile/`
**See also:** [ADR-0013](../adr/0013-canonical-profile-document-model.md) (document model) ·
[ADR-0014](../adr/0014-lexical-block-tree-profile-model.md) (block tree, supersedes per-section templates) ·
[ADR-0023](../adr/0023-stock-lexical-link-node.md) (links are stock Lexical `LinkNode`) ·
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
| Link | `mod+K` | Action, not a block: links the selection, or inserts a link at the caret |
| Timeline | `mod+Shift+6` | Dated entries (role, study, project) |

The rail is a labelled `role="toolbar"`; every button carries an accessible name
and `aria-keyshortcuts`.

**Insertion follows the caret.** With the caret inside a timeline entry,
inserting List or Chips places the node *inside that entry*, right after the
block holding the caret — and the rail narrows to the widgets valid there
(`text`, `list`, `chips`, plus the Link action); Title and Timeline are not
offered and their hotkeys are no-ops. Outside an entry, insertion anchors at root
level.

**Timeline entries** hold a Title, a single free-text Dates field, and a rich
description. Those three subsections are required and non-removable: editing can
clear a field's text but Backspace at the start or Delete at the end of a
subsection is a no-op, so an entry never collapses or merges into its neighbour.

**Links are inline text.** A link is a run inside a paragraph, a list item, or
a timeline entry's description — never a block of its own — and is Lexical's
stock `LinkNode` ([ADR-0023](../adr/0023-stock-lexical-link-node.md)). Titles,
entry Title/Dates fields and chips cannot hold links: there the rail's Link button
is disabled and `mod+K` does nothing. `mod+K` or the Link button opens a floating
link editor whose mode depends on the selection:

- **Wrap** — with text selected, it asks for a **Link URL** and links the selection.
- **Insert** — at a collapsed caret, it asks for **Link text** and **Link URL** and
  inserts the link at the caret; an empty text uses the URL as the label. The
  caret lands after the new link.
- **View** — with the caret inside a link, it shows the URL (opens in a new tab)
  with **Edit** and **Remove**. Edit changes the URL; confirming an empty URL, or
  Remove, unwraps the link and keeps its text as plain text.

Nothing is written to the document until the user confirms; Escape or clicking
away cancels and returns focus to the text. URLs are normalised: a bare domain
gets `https://`, a bare email gets `mailto:`, and only `http`, `https`, `mailto`
and `tel` are accepted — anything else disables confirm and shows "Enter a valid
URL". Typing right after a link continues as plain text. Typed or pasted URLs
(`https://…`, `www.…`, email addresses) become links automatically, including
plain-text URLs already in a document when it opens; pasting a URL over a
selection links the selection. Clicking a link in the editor places the caret and
never navigates.

**Empty regions are visible.** Empty structural fields (title text, entry title,
entry dates) render as a tinted dashed slot with placeholder text. An empty
document region shows "type here, or insert a widget from the rail"; an empty
entry description shows a "Describe it — …" hint. Every marker disappears the
moment the region has content, so a finished CV is clean.

**Pasting into a single-line field** (a title, entry title, or dates) flattens
the clipboard to one line of plain text inside that field — rich or
multi-paragraph content never spills out as sibling blocks or splits an entry.
Pasting into a description or other flow region keeps its block structure.

**Reordering and removal.** Two things can be dragged, each by a `⠿` handle that
appears in the left gutter on hover:

- **A section** — the handle beside a title moves the title *and its whole group*
  as a unit.
- **A timeline entry** — the handle beside an entry's Title moves that entry, with
  its Dates, description and any nested lists or chips, to another position in
  the *same* timeline, including its very top or bottom. A timeline with a single
  entry shows no handle.

While dragging, a drag image of the section or entry follows the pointer and a
drop-indicator line shows where it will land. Dropping it back where it was,
outside a valid target (for an entry, anywhere outside its own timeline), or
pressing Escape cancels with no change. A drop is one history step and leaves the
editor focused with the caret at the end of the moved title, so ⌘/Ctrl+Z undoes
it straight away. Drag is the only reorder path — there are no move-up/move-down buttons,
and non-title blocks at root have no handle. Drags are mouse-driven
(pointer events on `window`, not native HTML5 drag-and-drop).

A ✕ button in the left gutter removes a title's section, or a single timeline
entry (removing a timeline's last entry removes the timeline), immediately and
with no confirmation; ⌘/Ctrl+Z restores it through the editor's history.

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
| `root` | — | `title`, `paragraph`, `list`, `chips`, `timeline` |
| `title` | `text` | — (leaf) |
| `paragraph` | — | `text`, `inlineLink` |
| `text` | `text` | — (leaf) |
| `inlineLink` | `text`, `url` | — (leaf) |
| `list` | — | `listItem` |
| `listItem` | — | `paragraph`, `list`, `chips` |
| `chips` | — | `chip` |
| `chip` | `text` | — (leaf) |
| `timeline` | — | `entry` |
| `entry` | `title`, `dates` | `paragraph`, `list`, `chips` |

Nesting outside this matrix is rejected: the editor cannot author it, cv-api
refuses it on write, and the PDF walk may assume it. Flow nesting depth is
bounded (default 4; `list` and `timeline` are the depth-incrementing containers —
`entry` is not).

The body is a **flat, title-anchored** list. The old `section` node type is
retired; documents that still contain `section` nodes are migrated in memory on
load — each section becomes a `title` node carrying its heading, followed by the
section's former children, appended flat to root. The old standalone `link`
block is retired the same way: wherever it appears (root, list item, entry) it
becomes a `paragraph` that keeps the link's id and holds one `inlineLink` run
(label = its text, or the URL when the text is empty; a link with no URL becomes
plain text, and one with neither is dropped). The editor applies both migrations
on load and to every AI patch before validating it; cv-api applies them on read,
on write, and to CVs imported by the LLM. Everything emitted by the editor is
already in the current shape. Generated-CV snapshots are not rewritten, so the
PDF renderer still draws a legacy `link` block as a link line.

An `inlineLink` keeps its `id` across edits and serialisations (it is stored on
the Lexical node as node state), so AI patches can address a link directly —
e.g. `setAttrs` to change its URL.

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

Link `title`/`target`/`rel` attributes; bold or italic inside a link label;
links in titles, entry Title/Dates fields, or chips. Removing a link whose label
is itself a URL does not stick — autolink relinks it the next time the document
opens. Text marks other than links (bold, italic, colour), raw-HTML or arbitrary-node
insertion, per-widget styling, collaborative editing, and an unsaved-changes
navigation guard. Reordering individual non-title blocks at root, moving an
entry into a different timeline, and reordering list items or chips have no UI
affordance — move the group, or cut and re-insert. Reordering by keyboard or
touch is not supported.

> **History.** This feature has been rebuilt twice. The original form-based editor
> (personal-info form, work/education entry lists, skills, section-order
> drag-and-drop, live preview pane) was replaced by the canonical document model
> in ADR-0013, whose per-section template array was in turn replaced by the single
> block tree in ADR-0014. Both ADRs record the reasoning.

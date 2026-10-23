# ADR-0022: Links are Lexical's stock LinkNode; the standalone link block is retired

- **Status:** Accepted
- **Date:** 2026-10-19

## Context

The profile editor (ADR-0014) had two custom link implementations:

- a **`link` block** — a decorator node rendering a standalone link line with its
  own React form for text and URL, persisted as a `link` node in the block tree;
- an **inline link** — `PbInlineLinkNode`, a subclass of `@lexical/link`'s
  `LinkNode` that existed only to carry the block tree's stable `id`, edited by a
  hand-written floating editor that inserted a `https://` placeholder link into the
  document immediately and cleaned it up on cancel, with custom caret placement to
  stop the caret falling back inside the link.

Both were unreliable in use (placeholders left behind, the editor re-opening on
the same tick it closed, labels lost, caret landing inside links), and having two
shapes for one concept leaked into every consumer: three schema mirrors, the PDF
renderer, and the LLM prompts — which only described the block, so the AI never
authored inline links.

The block tree's `inlineLink` needs a stable `id`, because AI patches address
nodes by id and the editor is re-serialised on every change.

## Decision

We will use `@lexical/link`'s `LinkNode` and `AutoLinkNode` unmodified (no
subclass, no node replacement) as the only link representation in the editor,
together with the stock `LinkPlugin`, `AutoLinkPlugin` and `TOGGLE_LINK_COMMAND`.

- The `inlineLink` id is carried with Lexical **NodeState** (`createState('pbId')`)
  on the stock node. A node transform assigns a fresh id when it is missing or
  duplicated (e.g. when Lexical splits a link), so links created by commands,
  paste or autolink get one in the same update.
- The editor has one floating link editor (wrap / insert / view), modelled on the
  Lexical playground's, that writes nothing to the document until the user
  confirms.
- The standalone `link` block type is **retired** from the block tree in all three
  mirrors (`model.ts`, `ProfileDocumentSchema.cs`, `schemas.py`). Legacy `link`
  blocks migrate to `paragraph` (keeping the id) > `inlineLink`, the same way
  `section` was retired: in the editor on load and on every AI patch, and in
  cv-api on GET, PUT and LLM import. The PDF renderer keeps drawing legacy `link`
  blocks because generated-CV snapshots are never rewritten.
- The LLM prompts describe links only as `inlineLink` runs in paragraphs.

## Alternatives considered

- **Fix the custom implementations in place.** Rejected: the bugs came from
  re-implementing behaviour Lexical already ships (insert-after-link, toggling,
  URL validation, autolink), and two link shapes would remain.
- **Keep a thin `LinkNode` subclass for the id.** That was the old
  `PbInlineLinkNode`; a subclass needs a node replacement, its own serialisation,
  and breaks `instanceof` assumptions in the link plugins (`AutoLinkNode` is a
  separate class and needed its own subclass). NodeState attaches the id without
  any of that.
- **Drop link ids and let them be ephemeral.** Rejected: an AI patch computed on
  one serialisation would miss its target after the next.
- **Keep the `link` block for AI-authored content.** Rejected: it kept every
  consumer handling two shapes; migration on read covers stored data.

## Consequences

- One link code path; upgrading Lexical brings link fixes for free.
- Stored profiles with `link` blocks upgrade on their next open and save; until
  then cv-api's migration hides the old shape from the editor and the API. Paths
  that hand stored documents straight to llm-service (CV generation, cover
  letters, cross-profile chat context) may still show it a legacy `link` node;
  llm-service does not validate its inputs, so this only means the model sees an
  older node shape.
- Autolink runs on load, so plain-text URLs already in a document become links,
  and removing a link whose label is itself a URL does not survive a reload.
  Revisit (an explicit "not a link" mark in the model) if users object.
- `PbTextNode` reports itself as simple text so the autolink transform acts on it.

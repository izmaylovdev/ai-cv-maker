# ADR-0013: Section-based ProfileDocument as the canonical profile model

- **Status:** Accepted
- **Date:** 2026-06-20

## Context

The profile data model started life as a fixed, structured shape: a `Profile`
with `FullName`/`Title`/`Overview`/contacts plus three typed child collections —
`WorkExperience`, `Education`, `Skill`. That shape is woven through every
service:

- **cv-api** persists it as four EF Core tables and exposes it via
  `ProfileDto` / `UpdateProfileRequest`.
- The **gRPC contract** (`proto/llm_service.proto`) encodes it as `ProfileInput`
  with structured work/education/skill messages, consumed by `Generate`,
  `Optimize`, `ExtractProfile`, `Chat`, and `SelectBestProfile`.
- **llm-service** prompts produce and consume those structured fields.
- **PDF generation** renders a fixed set of sections in a configurable order
  over the same three collections.

The new document-style profile builder (`apps/profile-builder-ui`,
`<applysy-profile-builder>`, introduced as the experimental editor) deliberately
uses a *generic* model instead: a `ProfileDocument` of freely
added/removed/reordered `sections` (free-form, timeline, list) plus a fixed
identity/contact `header`. This is a better fit for how people actually write
CVs — arbitrary sections (Projects, Publications, Volunteering, …), not a fixed
trio — and it is the editor we are standardising on.

The two models are incompatible. We decided (with the product owner) to replace
the old editor with the builder. The open question was whether to keep the
structured model behind a boundary adapter or to make the builder's model
canonical everywhere. We chose the latter; this ADR records that decision and
its cross-service consequences.

## Decision

We will make the builder's **section-based `ProfileDocument` the canonical
profile model across all services.** The structured `WorkExperience` /
`Education` / `Skill` representation is retired.

- **Model.** A profile is `{ header, sections[] }`. `header` carries identity and
  contact fields (`fullName`, `title`, `email`, `phone`, `location`). Each
  section has a stable `id`, a `template` (`free-form` | `timeline` | `list`), a
  `heading`, and template-specific content. Section order in the array *is* the
  document order — the separate `SectionOrder` field is removed.
- **Persistence (cv-api).** `Profile` stores the document as a single JSON
  column. The `WorkExperiences`, `Educations`, `Skills` tables and the
  `FullName`/`Title`/`Overview`/`Location`/`ContactEmail`/`ContactPhone`/
  `SectionOrder` columns are dropped. A migration backfills existing rows into
  the document shape before dropping them (overview → a free-form "Summary"
  section, work/education → timeline sections, skills → a list section, contacts
  → header). `Name` (the profile's label) and identity/ownership columns remain.
- **gRPC contract.** `ProfileInput` and the structured optimize/extract messages
  are replaced by a document representation (`header` + repeated `section`).
  `Generate`, `Optimize`, `ExtractProfile`, `Chat`, and `SelectBestProfile`
  speak documents in and out.
- **llm-service.** Chains are reworked to read and emit the document model.
  Optimize/extract return a `ProfileDocument`; chat proposals patch it.
- **PDF.** The renderer iterates `header` + `sections` generically (heading +
  body/entries/bullets), instead of the fixed three-section layout.
- **Angular.** `/job-profiles/:id` embeds `<applysy-profile-builder>`, loading
  and saving the document; the old `ProfileComponent` and its reactive-form/
  structured model are removed.

The TypeScript `ProfileDocument` in `apps/profile-builder-ui/src/model.ts` is the
reference definition; other services mirror its shape.

## Alternatives considered

- **Boundary adapter (keep structured model canonical, map at the edge).**
  Persist the document but derive a structured `Profile` for AI/PDF so those
  pipelines stay untouched. Rejected: it permanently caps the product at the old
  fixed sections — arbitrary user sections could never reach the AI or the PDF —
  which defeats the reason for adopting the builder. The derivation logic and
  dual representation would also be a long-lived source of drift.
- **Dual write / hybrid (persist both, derive structured for compatibility).**
  Same ceiling as the adapter, plus two sources of truth to keep consistent.
  Rejected as a permanent design; the backfill migration borrows the same
  mapping but only once, at cut-over.
- **Keep both editors behind a flag.** Rejected: doubles the surface area of an
  already cross-cutting model and indefinitely postpones the contract decision.

## Consequences

- **Easier:** one model end to end; new section types are additive and flow to
  AI and PDF without contract changes; the editor and the wire format finally
  match.
- **Harder / new obligations:**
  - The gRPC contract and llm-service prompts must be regenerated and re-tuned;
    the AI loses *typed* date/degree semantics and must infer structure from
    section conventions (e.g. a `timeline` section's free-text `dates`).
  - PDF output is now driven by whatever sections the user creates; layout must
    degrade gracefully for unknown/empty sections.
  - The backfill migration is one-way. Rollback after deploy means restoring
    from backup, not a down-migration (consistent with ADR-0003: migrations run
    as a deploy step).
  - admin-api and any analytics reading the old columns must be checked.
- **Revisit if:** the AI quality regression from losing typed fields proves
  unacceptable — in which case we would re-introduce typed hints *within* the
  section model rather than reverting to fixed collections.

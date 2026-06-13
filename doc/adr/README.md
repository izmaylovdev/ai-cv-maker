# Architecture Decision Records (ADRs)

This section records significant technical decisions: infrastructure, security,
cross-service architecture, technology choices. Anything where a future reader
will ask "why is it done this way?" and the answer is not visible in the code.

## When to write an ADR

Write an ADR for work that is **not user-visible behavior**:

- Infrastructure and deployment topology (networking, ingress, IAM, scaling)
- Security hardening (auth between services, secrets handling)
- Cross-cutting technology choices (frameworks, protocols, data stores)
- Reversals of earlier decisions (supersede the old ADR, don't edit it)

User-visible features keep the regular flow (`doc/<domain>/user-stories/` +
`doc/<domain>/specs/`). The two can pair: an outcome-level user story may link
to an ADR that records the decision behind it.

## Rules

- Numbered sequentially: `NNNN-short-kebab-title.md` (e.g. `0001-llm-service-network-privacy.md`).
- ADRs are **immutable once accepted**. If a decision changes, write a new ADR
  that supersedes the old one and update the old ADR's status line only.
- Keep alternatives honest — record what was rejected and why, including
  constraints discovered the hard way.

## Template

```markdown
# ADR-NNNN: <Title>

- **Status:** Proposed | Accepted | Superseded by ADR-NNNN
- **Date:** YYYY-MM-DD

## Context

What situation forced a decision? Include the constraints that shaped it.

## Decision

What was decided, stated as fact ("We will...").

## Alternatives considered

Each rejected option and the concrete reason it lost.

## Consequences

What becomes easier, what becomes harder, what new obligations exist
(including operational ones), and what would trigger revisiting this.
```

## Index

| ADR | Title | Status |
|---|---|---|
| [0001](0001-llm-service-network-privacy.md) | llm-service network privacy on Cloud Run | Accepted |
| [0002](0002-secret-management.md) | Secret management for GCP infrastructure | Accepted |
| [0003](0003-migrations-and-image-pinning.md) | Migrations as a deploy step; SHA-pinned image deploys | Accepted |
| [0004](0004-admin-api-main-db-access.md) | admin-api read-only access to the main database | Accepted |

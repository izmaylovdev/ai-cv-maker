# Applysy — Documentation

```
doc/
├── adr/               — Architecture Decision Records: why the system is the way it is
├── web-client/        — the Angular SPA + cv-api (the product itself)
├── chrome-extension/  — the browser extension
└── admin/             — admin panel (admin-ui + admin-api)
```

## What goes where

| | Answers | Lives in |
|---|---|---|
| **Feature docs** (`doc/<domain>/*.md`) | What does this part of the product do today, and how? | One file per capability, describing current behaviour in the present tense |
| **[ADRs](adr/)** | Why did we choose this, and what did we reject? | One file per decision, immutable once accepted |
| **[ARCHITECTURE.md](../ARCHITECTURE.md)** | How do the services fit together? | System topology, service responsibilities, cross-cutting data model, auth flow, deployment |
| **[README.md](../README.md)** | How do I run it? | Setup, commands, environment variables |

Feature docs describe **behaviour**, not history and not implementation
walkthroughs. They link to ARCHITECTURE.md rather than restating system-level
detail, and to the ADR that explains any decision worth explaining. When a
feature is rebuilt, the doc is rewritten to describe the new behaviour — the old
version stays in git history and the reasoning stays in the ADR.

Each doc ends with a **Not implemented** section. That is deliberate: knowing what
was considered and left out is as useful as knowing what exists.

## Domains

### [web-client](web-client/) — the user-facing app

| Doc | Covers |
|---|---|
| [authentication.md](web-client/authentication.md) | Registration, login, Google sign-in, sessions, refresh tokens |
| [job-profiles.md](web-client/job-profiles.md) | Creating, listing, renaming, deleting profiles; CV import |
| [profile-editing.md](web-client/profile-editing.md) | The document editor, block-tree model, widgets |
| [chat.md](web-client/chat.md) | The AI assistant: global Q&A and the in-editor AI Editor |
| [cv-generation.md](web-client/cv-generation.md) | Generating tailored CVs and rendering PDFs |
| [ai-usage.md](web-client/ai-usage.md) | Token metering, cost, spending limits, prompt caching, observability |
| [billing.md](web-client/billing.md) | Balance, top-ups, Stripe/Monobank channels |
| [settings.md](web-client/settings.md) | Global AI preferences |
| [developer-experience.md](web-client/developer-experience.md) | `@applysy/dev-shell` and `@applysy/theme` |

### [chrome-extension](chrome-extension/)

| Doc | Covers |
|---|---|
| [auto-fill.md](chrome-extension/auto-fill.md) | Field detection, quick fill, optimised-CV download, side-panel chat, extension auth |

### [admin](admin/)

| Doc | Covers |
|---|---|
| [users.md](admin/users.md) | Users list, spending limit, admin auth, admin-api topology |

### [adr](adr/)

Architecture Decision Records for infrastructure, security, and cross-service
decisions. See [adr/README.md](adr/README.md) for the template and when to write
one.

## Adding to these docs

Every functional change updates the feature doc it touches, in the same change —
not as a follow-up. Infrastructure, security, and cross-service work gets an ADR
instead of (or alongside) a feature doc. The `add-feature` skill walks the whole
workflow.

# AI CV Maker — Documentation

```
doc/
├── adr/               — Architecture Decision Records (infra, security, cross-service decisions)
├── web-client/        — end-user Angular SPA + cv-api (.NET)
│   ├── user-stories/
│   └── specs/
├── chrome-extension/  — browser extension (auto-fill)
│   ├── user-stories/
│   └── specs/
└── admin/             — admin panel (Next.js admin-ui + NestJS admin-api)
    ├── user-stories/
    └── specs/
```

## Domains

| Domain | Description |
|--------|-------------|
| [adr](adr/) | Architecture Decision Records — why the system is built the way it is |
| [web-client](web-client/) | User-facing app: auth, profiles, CV generation, AI features |
| [chrome-extension](chrome-extension/) | Browser extension: job application auto-fill |
| [admin](admin/) | Admin panel: user management |

User-visible features are documented as user stories + specs inside their
domain. Infrastructure, security, and cross-service work is documented as an
ADR (see [adr/README.md](adr/README.md) for the template and rules), optionally
paired with an outcome-level user story whose acceptance criteria stay at the
observable-outcome level — implementation detail lives in the ADR and spec.

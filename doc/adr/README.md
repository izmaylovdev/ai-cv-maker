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

User-visible behaviour is documented in the domain's feature docs
(`doc/<domain>/*.md`). The two pair naturally: a feature doc describes what the
system does and links to the ADR that records why.

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
| [0003](0003-migrations-and-image-pinning.md) | Migrations as a deploy step; SHA-pinned image deploys | Accepted (migration step amended by 0021) |
| [0004](0004-admin-api-main-db-access.md) | admin-api read-only access to the main database | Superseded by 0005 |
| [0005](0005-admin-api-via-cv-api.md) | admin-api reads user data via a cv-api endpoint | Accepted |
| [0006](0006-cicd-workload-identity.md) | CI/CD deploys via Workload Identity Federation | Accepted |
| [0007](0007-landing-page-deployment.md) | Landing page on Cloud Run behind the shared LB | Accepted (LB routing superseded by 0020) |
| [0008](0008-cloud-run-scale-to-zero.md) | Scale-to-zero and request-based billing for idle Cloud Run services | Accepted |
| [0009](0009-smallest-db-tier.md) | Smallest Cloud SQL tier (db-f1-micro) for the idle platform | Superseded by 0021 |
| [0010](0010-langfuse-llm-observability.md) | Langfuse for LLM observability (self-hosted, opt-in) | Accepted (amended by 0021) |
| [0011](0011-langfuse-prod-single-vm.md) | Langfuse production hosting on a single GCE VM | Accepted (amended by 0021) |
| [0012](0012-langfuse-evals.md) | Run LLM evals through Langfuse datasets and experiments | Accepted (amended by 0021) |
| [0013](0013-canonical-profile-document-model.md) | Section-based ProfileDocument as the canonical profile model | Accepted (body amended by 0014) |
| [0014](0014-lexical-block-tree-profile-model.md) | Lexical rich-text block tree as the canonical profile body | Accepted |
| [0015](0015-remove-optimize-enhance-endpoints.md) | Remove the unused Optimize and EnhanceField AI endpoints | Accepted |
| [0016](0016-distributed-tracing-tempo-otel.md) | Distributed tracing with OpenTelemetry and Grafana Tempo | Accepted |
| [0017](0017-google-signin-token-trust.md) | Bind Google sign-in to our OAuth client and verified email | Accepted |
| [0018](0018-isolate-tempo-tracer-provider-from-langfuse.md) | Isolate the Tempo tracer provider from Langfuse | Accepted |
| [0019](0019-anthropic-prompt-caching.md) | Anthropic prompt caching and cache-aware usage accounting | Proposed |
| [0020](0020-cloudflare-worker-replaces-lb.md) | Replace the global HTTPS load balancer with a Cloudflare Worker proxy | Proposed |
| [0021](0021-firestore-replaces-cloud-sql.md) | Move the main and admin databases to Firestore | Accepted |
| [0022](0022-llamaindex-chat-ui-widget.md) | Build the chat widget on LlamaIndex Chat UI | Accepted |
| [0023](0023-stock-lexical-link-node.md) | Links are Lexical's stock LinkNode; the standalone link block is retired | Accepted |

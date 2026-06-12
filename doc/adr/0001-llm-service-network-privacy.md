# ADR-0001: llm-service network privacy on Cloud Run

- **Status:** Accepted
- **Date:** 2026-06-12

## Context

After the Azure → GCP migration, `llm-service` (the gRPC LLM gateway holding
the paid provider API keys) was deployed with `ingress = INGRESS_TRAFFIC_ALL`
and `roles/run.invoker` granted to `allUsers`. Combined with
`add_insecure_port` and no auth check in the servicer, **anyone on the
internet could call `Generate`, `Chat`, `GenerateCoverLetter`, etc. directly**
— a free proxy to the LLM provider that also bypasses the `LlmUsage`
accounting in cv-api.

The open ingress was not an oversight of intent: Cloud Run v2's
`INGRESS_TRAFFIC_INTERNAL_ONLY` treats Cloud-Run-to-Cloud-Run calls via
`.run.app` URLs as *external* (unlike v1), so when cv-api had no VPC egress,
internal-only ingress broke cv-api → llm-service entirely (manifested as
`Unimplemented / HTTP 404` from the Cloud Run LB; see commit `4504f31`).
`INGRESS_TRAFFIC_ALL` was the workaround, but the compensating IAM restriction
was never applied.

Related exposure discovered during review: Cloud SQL has a public IP with
`authorized_networks = 0.0.0.0/0` — any internet host can attempt DB
connections, protected only by password + SSL.

## Decision

Make llm-service **network-private and IAM-private** in production:

1. **Per-service identities.** Dedicated service accounts for cv-api and
   llm-service (replacing the default compute SA).
2. **IAM enforcement at the edge.** `run.invoker` on llm-service granted only
   to cv-api's service account; `allUsers` removed. cv-api attaches a
   Google-signed ID token (audience = llm-service URL) to every gRPC call.
   Token verification is done by Cloud Run's front end **before** traffic
   reaches the container — no auth code in llm-service itself.
3. **Network privacy.** llm-service ingress set to
   `INGRESS_TRAFFIC_INTERNAL_ONLY`. cv-api gets **Direct VPC egress**
   (`ALL_TRAFFIC`) through a project VPC subnet with Private Google Access,
   which makes its `.run.app` calls arrive as internal traffic — resolving the
   v2 limitation that forced open ingress originally.
4. **Cloud SQL moves into the VPC.** Private IP via Service Networking
   peering; the `0.0.0.0/0` authorized network is removed. This also avoids
   needing Cloud NAT for DB traffic under `ALL_TRAFFIC` egress.
5. **Local development is unaffected.** docker-compose keeps plaintext gRPC
   with no tokens; ID-token attachment in cv-api is disabled by default and
   enabled by configuration in Cloud Run.

## Alternatives considered

- **Status quo (`allUsers` + open ingress):** rejected — unmetered public
  access to paid LLM quota; usage accounting bypassable.
- **IAM-private only (keep `INGRESS_TRAFFIC_ALL`):** closes the security hole
  with much less Terraform (no VPC, no Cloud SQL change). Rejected in favor of
  full network privacy: the URL remains a discoverable, probeable surface, and
  the VPC work also fixes the Cloud SQL `0.0.0.0/0` exposure.
- **In-service token validation (Python interceptor):** rejected as redundant
  defense-in-depth — Cloud Run validates ID tokens at the edge; extra code and
  a local-dev opt-out flag for no marginal protection in this topology.
- **Shared-secret metadata header:** rejected — weaker than platform IAM,
  another secret to rotate, and still leaves the service publicly routable.
- **Cloud NAT + public-IP Cloud SQL:** rejected — keeps `0.0.0.0/0` open and
  adds a billable NAT gateway only to preserve a worse posture.

## Consequences

- New Terraform surface: VPC, subnet (PGA enabled), Service Networking
  peering + reserved range, two service accounts, Direct VPC egress on cv-api.
- Attaching a private IP to Cloud SQL may cause a brief instance restart;
  Service Networking peering is hard to remove once created.
- All cv-api egress now traverses the VPC. Google-fronted endpoints
  (llm-service `.run.app`, OAuth/cert endpoints, metadata) are covered by
  Private Google Access; **any future non-Google outbound dependency from
  cv-api will require adding Cloud NAT.**
- llm-service can no longer be smoke-tested from a laptop via its URL;
  testing goes through cv-api or `gcloud run services proxy`.
- Revisit if: a second caller of llm-service appears (grant its SA invoker),
  or cv-api needs general internet egress (add NAT), or GCP lifts the
  v2 internal-ingress limitation for CR-to-CR traffic.

# ADR-0020: Replace the global HTTPS load balancer with a Cloudflare Worker proxy

- **Status:** Proposed
- **Date:** 2026-07-13

## Context

All browser-facing traffic is fronted by a global external HTTPS load balancer
(`infra/lb.tf`): three Google-managed certificates, serverless NEGs and a URL
map that does host-based routing on one static IP — `applysy.works` /
`www.applysy.works` → `landing`, `app.applysy.works` → `ui-angular`,
`admin.applysy.works` → `admin-ui`. The LB exists only because europe-central2
does not support Cloud Run domain mappings (ADR-0001, ADR-0007); it provides
nothing else the platform needs.

Its forwarding rules bill a flat ~$0.025/hr regardless of traffic —
**~$18/month, roughly 57% of the project's ~$32 idle bill**. For a platform
that is deliberately engineered toward a minimal idle cost (scale-to-zero
Cloud Run, ADR-0008; smallest DB tier, ADR-0009), the LB is the single largest
remaining fixed cost.

What the LB actually does for us is: terminate TLS for our hostnames, and
route by Host header to three public Cloud Run services. Both are things a
free tier of a CDN/edge provider can do.

## Decision

We will serve the public hostnames through **Cloudflare (free plan)** and
delete the load balancer:

- DNS for `applysy.works` moves to Cloudflare (nameserver change at the
  registrar). Cloudflare terminates TLS for the apex and first-level
  subdomains with its free universal certificate; "Always Use HTTPS" replaces
  the LB's port-80 redirect rule; SSL mode is **Full (strict)** — the origin
  leg is validated against Google's `*.run.app` certificate.
- A single **Cloudflare Worker** (`infra/cloudflare/worker.js`, deployed with
  `wrangler`) replaces the URL map: it maps each hostname to its Cloud Run
  `run.app` origin and forwards the request with the Host rewritten (Google's
  frontend routes by Host header, so a plain DNS CNAME cannot work). The
  original host is preserved in `X-Forwarded-Host`.
- `infra/lb.tf` is deleted entirely (certificates, NEGs, backend services,
  URL maps, proxies, forwarding rules, static IP). The
  `compute.googleapis.com` service enablement moves to `infra/network.tf`,
  which still needs it for the VPC.
- The cutover order is: Cloudflare zone live → Worker deployed and verified →
  only then `terraform apply` the LB removal. The runbook lives in
  `infra/cloudflare/README.md`.

Expected result: idle cost drops from ~$32/month to ~$13/month (Cloud SQL
becomes the dominant remainder, ADR-0009).

## Alternatives considered

- **Keep the LB.** Works, but ~$18/month at zero traffic is the antithesis of
  the ADR-0008/0009 cost posture, and none of the LB's paid capabilities
  (Cloud Armor, CDN, cross-region backends) are in use.
- **Move all services to a region with Cloud Run domain mappings**
  (e.g. europe-west1) and use free domain mappings. Viable and keeps
  everything inside GCP, but requires migrating the Cloud SQL instance
  (instances cannot change region: new instance + dump/restore + ~15–30 min
  downtime) and re-creating every regional resource — and domain mappings are
  still pre-GA, with Google itself recommending an LB or Firebase Hosting for
  production. Half a day of careful migration versus a two-hour, zero-downtime
  change lost.
- **Firebase Hosting rewrites to Cloud Run.** Also free, but needs one
  Firebase site per hostname, adds a second Google product surface, and Cloud
  Run rewrite support from europe-central2 was uncertain. The Worker is less
  moving parts.
- **Cloudflare without a Worker** (CNAME straight at `run.app`, or an Origin
  Rule rewriting the Host header). A bare CNAME fails because Google routes by
  Host header and would 404 our hostnames; Host header override via Origin
  Rules is Enterprise-only. The Worker is the free-plan mechanism.

## Consequences

- **~$18/month saved**; the remaining idle cost is essentially the Cloud SQL
  instance.
- **A new external dependency.** The Cloudflare account, DNS zone and Worker
  live outside Terraform state and are managed via the dashboard plus
  `wrangler deploy` from `infra/cloudflare/`. This is deliberate for a
  single-zone, single-Worker setup; adopt the Cloudflare Terraform provider
  if drift ever becomes a problem.
- **Free-tier limits.** Workers free plan allows 100k requests/day with 10 ms
  CPU per request — orders of magnitude above current traffic. Revisit (paid
  Workers at $5/month, still cheaper than the LB) if traffic approaches this.
- The three public services keep `INGRESS_TRAFFIC_ALL`, so their `run.app`
  URLs remain directly reachable, bypassing Cloudflare. This is not a
  regression — the LB never restricted ingress either — but any future
  Cloudflare-level protection (WAF rules, rate limiting) is only as strong as
  this bypass allows. Locking ingress to Cloudflare IPs would require a
  different mechanism and its own ADR.
- Certificate management moves from Google-managed certs to Cloudflare's
  universal certificate. All four hostnames are apex or first-level
  subdomains, which the free universal cert covers; deeper subdomains
  (`x.y.applysy.works`) would need the paid Advanced Certificate Manager.
- ADR-0007's routing mechanism ("through the existing load balancer") is
  superseded; the `landing` Cloud Run service and its CI path are unchanged.
- Rollback before teardown is trivial (remove the Worker routes; the proxied
  DNS records still point at the LB IP). After teardown, rollback means
  re-creating the LB via git revert + `terraform apply` and waiting out
  managed-cert provisioning again.

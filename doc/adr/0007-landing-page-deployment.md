# ADR-0007: Landing page deployment on Cloud Run behind the shared LB

- **Status:** Accepted (LB routing superseded by ADR-0020; the landing service itself is unchanged)
- **Date:** 2026-06-16

## Context

`apps/landing` is a new standalone marketing site — a single static `index.html`
(no framework, no API calls) bundled by Vite and served by Nginx. It needs a
public home on its own domain, separate from the application at
`app.applysy.works`.

The platform already fronts all browser-facing traffic with one global external
HTTPS load balancer that does host-based routing on a single static IP
(`app.applysy.works` → `ui-angular`, `admin.applysy.works` → `admin-ui`; see
ADR-0001 for why europe-central2 forces an LB instead of Cloud Run domain
mappings). Static UIs (`ui-angular`, `chat-ui`) run as Nginx Cloud Run services.

## Decision

We will deploy `landing` as its own Cloud Run service and serve it at the apex
domain `applysy.works` (and `www.applysy.works`) through the **existing** load
balancer:

- A Cloud Run service `landing` (Nginx, port 80, `min_instances = 0`,
  `cpu_idle = true`), public `roles/run.invoker` for `allUsers`, ingress
  `INGRESS_TRAFFIC_ALL`. It is purely static — **no** Direct VPC egress, no
  secrets, no DB.
- A serverless NEG + backend service, a new Google-managed SSL certificate for
  `applysy.works` and `www.applysy.works` added to the existing HTTPS proxy, and
  a host rule + path matcher on the existing URL map. No new IP, proxy, or
  forwarding rule — the apex reuses the LB's single global address.
- CI builds and pushes `apps/landing/Dockerfile` and rolls the service by SHA
  tag, exactly like the other static UIs (ADR-0003 image pinning still applies:
  Terraform's `:latest` is bootstrap-only, `ignore_changes` on the image).

## Alternatives considered

- **Cloud Storage static website bucket.** Cheapest for pure static files, but
  it would introduce a second serving mechanism, separate cache/TLS handling,
  and a different CI path. Reusing the Cloud Run + Nginx + LB pattern keeps one
  deployment story for every browser-facing app.
- **Serve the landing page from `ui-angular`'s Nginx.** Couples marketing
  content to the SPA's release cycle and container, and muddies the apex/app
  domain split. Keeping a separate service lets the marketing site ship
  independently.
- **A separate load balancer / IP for the apex.** Unnecessary cost and DNS
  surface; the existing LB already does host-based routing, so the apex is just
  one more host rule and one more managed certificate.

## Consequences

- The apex `applysy.works` and `www.applysy.works` must have DNS A records
  pointing at the LB's existing global IP (`terraform output dns_a_record`).
  Until both names resolve to that IP, the Google-managed certificate stays in
  `PROVISIONING` and the site serves a cert error — same provisioning caveat as
  the other domains.
- One more build/deploy step in `deploy.yml` and one more Cloud Run service to
  operate. The service scales to zero, so idle cost is negligible.
- The landing page's CTAs link out to `https://app.applysy.works` (configurable
  via the `APP_ORIGIN` constant in `index.html`); the marketing and app domains
  stay cleanly separated.
- Revisit if marketing needs a CDN/edge cache or moves to a managed static host
  (e.g. Firebase Hosting), which would supersede this ADR.

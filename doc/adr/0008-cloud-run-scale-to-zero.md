# ADR-0008: Scale-to-zero and request-based billing for idle Cloud Run services

- **Status:** Accepted
- **Date:** 2026-06-16

## Context

The platform has no production traffic yet, but the Google Cloud bill was
tracking to ~$136/month (already $51 by mid-June). A cost report broken down by
SKU showed the spend was almost entirely **Cloud Run "instance-based" CPU**
(~$42) rather than request processing — the request-based CPU SKU was $0.08.

Four Cloud Run services were billing for the full lifetime of a warm instance
instead of only during requests:

- `cv-api`, `prometheus`, `grafana` had `min_instance_count = 1` **and** no
  `cpu_idle` setting (defaulting to `cpu_idle = false`, i.e. CPU always
  allocated). Each kept ≥1 instance running 24/7 at full CPU.
- `llm-service` had `min_instance_count = 0` but still `cpu_idle = false`, so
  any instance kept warm (e.g. by health checks or a Prometheus scrape) billed
  full CPU for its whole lifetime.

The other browser-facing services (`chat-ui`, `ui-angular`, `landing`,
`admin-ui`, `admin-api`) were already `min_instance_count = 0` + `cpu_idle =
true` and cost effectively nothing at idle.

## Decision

We will run all application Cloud Run services scale-to-zero with request-based
billing by default:

- Set `min_instance_count = 0` on `cv-api`, `prometheus`, and `grafana`.
- Set `cpu_idle = true` on `cv-api`, `prometheus`, `grafana`, and
  `llm-service`.

`max_instance_count` is unchanged. CI still owns the running image by SHA tag;
`ignore_changes` on the image (ADR-0003) is unaffected.

A warm instance (`min_instance_count = 1`, `cpu_idle = false`) is reserved for
services that genuinely need to be always-on under real load, and is
re-introduced per service with its own justification — not as the platform
default.

## Alternatives considered

- **Leave `min_instance_count = 1` and only flip `cpu_idle = true`.** Keeps a
  warm instance for fast first-byte latency, but still bills a throttled
  instance around the clock. With no users, paying for warmth nobody benefits
  from is waste. Scale-to-zero wins until there is traffic to justify warmth.
- **Delete `prometheus` and `grafana` entirely.** Cleanest possible saving for
  an unused monitoring stack (see Consequences — scaled-to-zero Prometheus is
  not a functional scraper). Rejected for now to preserve the dashboards/config;
  flagged as the follow-up if monitoring stays unused. A removal would supersede
  this ADR for those two services.
- **Stop the whole environment (delete services).** Too blunt — the app should
  stay deployable and demoable on demand. Scale-to-zero keeps every endpoint
  live at near-zero idle cost.

## Consequences

- Idle Cloud Run cost drops to roughly zero; the remaining recurring spend is
  the shared load balancer forwarding rule (~$2.82/mo) and any running Cloud SQL
  instance.
- Cold starts on first request for the affected services. Acceptable for a
  no-traffic platform; reconsider warmth for `cv-api` once it serves real users.
- **`prometheus` scaled to zero is not a continuously-scraping metrics store** —
  it only runs when its endpoint is hit, and `cpu_idle` throttles it between
  requests. Treat monitoring as effectively off until a service is restored to
  `min_instance_count = 1`. Same caveat for Grafana background alerting.
- These settings were first applied by hand in the console to stop the bleeding;
  this ADR + the `infra/apps.tf` edits make them the source of truth so the next
  `terraform apply` does not revert them.
- Revisit when the platform takes real traffic: warmth and continuous monitoring
  may be worth paying for, per service, with their own rationale.

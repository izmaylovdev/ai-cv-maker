# Cloudflare edge for applysy.works (ADR-0020)

Cloudflare (free plan) terminates TLS for the public hostnames and a single
Worker ([worker.js](worker.js)) does the host-based routing to Cloud Run that
the deleted GCP load balancer used to do:

| Host | Cloud Run origin |
|---|---|
| `applysy.works`, `www.applysy.works` | `landing` |
| `app.applysy.works` | `ui-angular` |
| `admin.applysy.works` | `admin-ui` |

This directory is not managed by Terraform — the Cloudflare zone is configured
in the dashboard and the Worker is deployed with `wrangler`. See
[ADR-0020](../../doc/adr/0020-cloudflare-worker-replaces-lb.md) for the
decision record.

## One-time cutover runbook

Order matters: the GCP load balancer keeps serving until step 6, so every step
before it is zero-downtime and reversible.

1. **Create the Cloudflare zone.** Sign up / log in at dash.cloudflare.com,
   add the site `applysy.works` on the **Free** plan. Cloudflare imports
   existing DNS records — verify all four hostnames are present as records
   pointing at the old LB IP and set each to **Proxied** (orange cloud). Add
   any missing ones as `A` records to the LB IP, Proxied.
2. **Switch nameservers** at the domain registrar to the two nameservers
   Cloudflare assigns. Wait until the zone shows **Active** (minutes to a few
   hours). Traffic still reaches the LB throughout — records are unchanged.
3. **Zone settings** (SSL/TLS app): set encryption mode to **Full (strict)**
   and enable **Always Use HTTPS** (replaces the LB's port-80 redirect).
4. **Deploy the Worker:**

   ```sh
   cd infra/cloudflare
   npx wrangler deploy    # prompts for Cloudflare login on first run
   ```

   The routes in [wrangler.toml](wrangler.toml) attach it to all four
   hostnames; from this moment the Worker serves the traffic and the LB is
   idle.
5. **Verify** each hostname serves through Cloudflare (look for a `cf-ray`
   response header) and the apps work:

   ```sh
   for h in applysy.works www.applysy.works app.applysy.works admin.applysy.works; do
     curl -sI "https://$h/" | grep -iE "^(HTTP|cf-ray)"
   done
   curl -s -o /dev/null -w "%{http_code}\n" https://app.applysy.works/api/job-profiles  # 401
   ```

   Rollback at this point = delete the Worker routes in the dashboard; the
   proxied DNS records still point at the LB.
6. **Tear down the LB:** merge the branch that deletes `infra/lb.tf`, then
   from `infra/`: `terraform apply` (destroys certs, NEGs, backends, proxies,
   forwarding rules and the static IP — ~$18/month gone).
7. **Housekeeping:** the DNS records now point at a freed IP. The Worker
   intercepts all proxied traffic so the target is never contacted, but
   replace them with a placeholder `AAAA` record to `100::` (still Proxied)
   so nothing dangles. Records must stay **Proxied** — grey-clouding a
   placeholder record breaks the host.

## Changing the routing

Origins are the services' `run.app` URLs (stable per project;
`gcloud run services list` to check). Edit `ORIGINS` in
[worker.js](worker.js) and run `npx wrangler deploy`. Adding a hostname also
needs a route in [wrangler.toml](wrangler.toml) and a proxied DNS record.

## Limits

Workers free tier: 100k requests/day, 10 ms CPU per request. If traffic ever
approaches that, the $5/month paid Workers plan is still far cheaper than the
load balancer it replaced.

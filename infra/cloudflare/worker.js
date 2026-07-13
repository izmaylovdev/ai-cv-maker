// Host-based router in front of Cloud Run (ADR-0020).
//
// Cloudflare terminates TLS for the applysy.works hostnames; this Worker
// replaces the deleted GCP load balancer's URL map. Google's frontend routes
// run.app requests by Host header, so a plain proxied CNAME would 404 — the
// Worker forwards each request to its Cloud Run origin with the Host
// rewritten, preserving the original host in X-Forwarded-Host.

const ORIGINS = {
  "applysy.works": "landing-hjlbiphpqq-lm.a.run.app",
  "www.applysy.works": "landing-hjlbiphpqq-lm.a.run.app",
  "app.applysy.works": "ui-angular-hjlbiphpqq-lm.a.run.app",
  "admin.applysy.works": "admin-ui-hjlbiphpqq-lm.a.run.app",
};

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const host = url.hostname;
    const origin = ORIGINS[host];
    if (!origin) {
      return new Response("Unknown host", { status: 404 });
    }
    url.protocol = "https:";
    url.host = origin;
    const forwarded = new Request(url, request);
    forwarded.headers.set("X-Forwarded-Host", host);
    return fetch(forwarded);
  },
};

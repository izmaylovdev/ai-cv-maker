# ADR-0021: Move the main and admin databases to Firestore

- **Status:** Accepted
- **Date:** 2026-08-10 (proposed), 2026-08-16 (accepted)

## Context

Cloud SQL is the dominant recurring cost of an otherwise idle platform.
Everything else already costs ~nothing when unused: all ten Cloud Run services
scale to zero (ADR-0008), the Langfuse VM is gated off behind
`var.langfuse_enabled` (ADR-0011), and the global HTTPS load balancer was
replaced by a Cloudflare Worker (ADR-0020). Cloud SQL has **no scale-to-zero**:
`ai-cv-maker-postgres` bills its full machine tier 24/7 while running.

Measured state of the project (`applysy-498807`, 2026-08-10):

| Fact | Value |
|---|---|
| Instance | `ai-cv-maker-postgres`, `POSTGRES_16`, ZONAL |
| Tier | `db-f1-micro` (ADR-0009) |
| Region | `europe-central2` |
| Disk | 10 GB `PD_SSD`, backups enabled |
| Disk actually used | **83 MB** (Cloud Monitoring, `database/disk/bytes_used`) |
| Activation policy | `ALWAYS`, state `RUNNABLE` |

Estimated at list price: ~$8–9/mo instance + ~$2/mo disk and backups, against a
total idle bill of roughly $13/mo. The database is ~80% of the spend.

ADR-0009 records the instance as **stopped by default**, started only to develop
or demo. Re-verified on 2026-08-16: the instance is `RUNNABLE` with
`activationPolicy: ALWAYS`, so it has been billing its full tier continuously.
This is drift from ADR-0009's stated operating model, not a change of intent —
and it means the saving in this ADR is **realised, not hypothetical**. ADR-0009's
"stopped by default" claim is stale and is superseded here.

### Constraints that shaped the choice

**Third-party databases require Cloud NAT; Google ones do not.** ADR-0001 gave
cv-api Direct VPC egress with `egress = "ALL_TRAFFIC"`, because a call to
llm-service's `.run.app` URL only counts as *internal* traffic — satisfying
`INGRESS_TRAFFIC_INTERNAL_ONLY` — when it leaves through the VPC. Private Google
Access covers Google-fronted endpoints but not third-party hosts, so any
non-Google database would need a Cloud NAT gateway. ADR-0001 states this
consequence and `infra/apps.tf:219` repeats it inline. No Cloud Router or NAT
exists today, and NAT's floor is ~$3.65/mo for its external IP regardless of
traffic. **Firestore is a Google API reached over PGA, so it needs no NAT.**

**Network posture.** Every managed third-party Postgres free tier (Neon,
Supabase) puts the database on the public internet behind password and TLS only
— private networking and IP allowlisting are paid-tier features. That
reintroduces exactly the exposure ADR-0001 closed when it removed
`authorized_networks = 0.0.0.0/0`. Firestore is reached through Google IAM with
no public database surface, leaving ADR-0001 intact.

**Firestore capability checks.** Two concerns raised during scoping did not
survive verification, and both had been used to argue against Firestore:

- Firestore supports server-side `count()`, `sum()` and `average()` aggregation
  queries, exposed in .NET as `AggregateField.Sum`. So
  `UsageService.EnsureWithinLimitAsync`, which sums `LlmUsage` cost on every LLM
  call, does **not** require maintained counters.
- Grafana's `pg-cv-maker` Postgres datasource is provisioned in
  `monitoring/grafana/provisioning/datasources/datasources.yml` but referenced
  by **no dashboard panel**. It is vestigial and blocks nothing.

**Free-tier shape.** Firestore's no-cost quota is 1 GiB stored, 50,000 document
reads, 20,000 writes and 20,000 deletes per day, and 10 GiB/month egress — and
it covers **exactly one database per project**.

## Decision

We will move all persistent application state to **Cloud Firestore in Native
mode** and delete the Cloud SQL instance.

1. **One Firestore database** (the project default, free-tier eligible), in a
   `europe-central2`-adjacent location. Both current databases share it,
   separated by top-level collection rather than by database, since the free
   tier covers only one.
2. **cv-api's persistence layer is rewritten** behind a repository seam. The 8
   entities become collections; `Profile`, `GeneratedCv`, `LlmUsage` and
   `BillingAccount` hang off `users/{id}` as subcollections; `AppSetting` is a
   small top-level collection. `AppDbContext`, EF Core and the 20 migrations
   are removed.

   **Amended 2026-08-16 / 2026-08-17, during implementation.** The layout
   above was written from the relational schema — from where a foreign key
   points. Building the seam showed that the thing which actually decides
   nesting in Firestore is **the key the application looks a document up by**,
   and for four of these entities that key does not contain the user. The
   settled layout is:

   ```
   users/{userId}                          User
   users/{userId}/profiles/{profileId}     Profile (Document as a JSON string field)
   users/{userId}/billing/account          BillingAccount (fixed document id)
   generatedCvs/{cvId}                     field: profileId
   llmUsage/{id}                           field: userId (nullable)
   refreshTokens/{tokenHash}               document id IS the token hash
   topUpPayments/{paymentId}               field: externalId
   appSettings/{key}                       document id IS the setting key
   admin_users/{id}                        admin-api
   ```

   The reasoning, entity by entity:

   - `RefreshToken` is fetched by token hash during sign-in refresh and
     `TopUpPayment` by payment id or provider external id from webhooks that
     carry no user identity at all. `GeneratedCv` is reached only ever by
     `(cvId, profileId)` — `CvService` never has the owning user in scope at
     those call sites. Nesting any of the three under `users/{id}` would turn
     its hottest lookup into a **collection-group query needing its own index**,
     where a top-level collection makes it a direct document read. Refresh
     tokens go further and use the token hash itself as the document id, so the
     hottest auth lookup is a single keyed get with no query and no index at all.

     **Amended 2026-08-17, during implementation.** "The document id is the
     token hash" needed one adjustment: `AuthService.HashToken` base64-encodes
     the SHA-256, and base64's alphabet contains `/`, which Firestore forbids in
     a document id (it is the path separator) — so roughly half of all hashes
     could not be used verbatim. The document id is therefore the **base64url**
     form of the same hash (`+`→`-`, `/`→`_`), a one-to-one character
     substitution that keeps it collision-free and keeps the lookup a keyed
     read with no index. The unmodified hash is also stored in a `token` field.
     **The import must apply the same substitution when deriving document ids
     from the exported `Token` column**, or no existing refresh token will
     resolve after the cutover. Changing `HashToken` to emit base64url directly
     was rejected: it would invalidate every refresh token in flight.
   - `LlmUsage.UserId` is **nullable** — unattributed usage rows exist and must
     still be recorded. A subcollection of `users/{id}` has nowhere to put them
     short of a second parallel collection, so usage stays top-level with a
     nullable `userId` field.
   - `Profile` and `BillingAccount` do stay under the user, because every access
     path to them already carries the user id. `BillingAccount` is one document
     per user, so it takes a **fixed document id** (`account`) rather than a
     generated one — that makes "does this user have a billing account?" a keyed
     read instead of a query, which is exactly what the confirmation transaction
     needs.

   This is the ADR's own "query patterns must be designed, not inherited"
   consequence arriving in practice: the relational shape was a poor guide, and
   ownership in the domain turned out not to imply nesting in the store.

3. **A repository interface is introduced deliberately, not incidentally**, so
   the 10 test files currently binding EF's `UseInMemoryDatabase` fake the seam
   instead of a database. This is the main defence against regressions in the
   rewrite.
4. **`PaymentConfirmationService` keeps its idempotency guarantee** using a
   Firestore transaction: the `Pending → Paid` status flip and the
   `BillingAccount.AllowanceUsd` credit commit atomically, so provider retries
   still cannot double-credit. This path gets dedicated tests before the cutover,
   not after.
5. **admin-api moves too.** It uses a raw `pg` `Pool` over a single
   `admin_users` table across ~5 files (`admin-database.module.ts`,
   `auth.service.ts`, `admin-users.service.ts`, `migrate.ts`), so it becomes an
   `admin_users` collection on the same Firestore database. Leaving it on
   Postgres would keep Cloud SQL alive and save nothing.
6. **Auth is by service-account IAM**, per-service, matching ADR-0001's
   identity model. No database passwords remain in Secret Manager.
7. **Data moves by one-off export/transform/import** of ~83 MB via the Cloud SQL
   Auth Proxy, with the Cloud SQL instance retained (stopped) for one rollback
   window before deletion.
8. **Local development uses the Firestore emulator** in docker-compose,
   replacing the `postgres` and `admin-db` containers.

## Alternatives considered

- **Neon / Supabase serverless Postgres.** Strongly considered, and the reason
  this ADR exists in its earlier form. Keeps EF Core, all 20 migrations, the 49
  query sites, the 21 transaction sites and all 10 EF-coupled test files
  **completely untouched** — the migration is a connection string plus a
  `pg_dump`/`pg_restore`. Rejected on two counts: it needs Cloud NAT (~$4/mo,
  cutting the ~$10 saving to ~$6), and its free tier puts the database on the
  public internet, partially reversing ADR-0001. Firestore wins on cost,
  network posture and latency; Neon wins overwhelmingly on effort. **If the
  rewrite proves larger or riskier than estimated — especially in the billing
  path — this is the fallback, and it is a cheap one to fall back to.**
- **Stop the Cloud SQL instance when not in use.** Zero work, zero risk, saves
  ~$8/mo, and is already what ADR-0009 says the operating model is. It remains
  the best value per unit of effort of anything in this document, and it is not
  mutually exclusive with this ADR. Rejected as the sole answer only because it
  leaves the platform undeployable on demand.
- **Firebase Realtime Database.** Older, weaker querying, no aggregation
  queries, single-region. No advantage over Firestore here.
- **Status quo on `db-f1-micro`.** The thing being fixed.

## Consequences

- **This is the largest single change in the codebase's history and a one-way
  door.** Reverting to Postgres after cutover means rewriting the persistence
  layer a second time and reversing a data migration; reverting from Neon would
  have been a connection-string change. The effort is concentrated in cv-api:
  8 entities, ~49 query sites, ~21 transaction sites across 14 files.
- **Relational guarantees move into application code.** Firestore has no foreign
  keys, so cascade deletes (`Profile`, `TopUpPayment` → `User`) become explicit
  recursive deletes, and referential integrity becomes a code invariant rather
  than a schema one. Transactions are capped at 500 writes.
- **The production Langfuse path is removed, by decision.**
  `infra/langfuse.tf:235` wired the Langfuse metadata DB to
  `google_sql_database_instance.db.private_ip_address`, and Langfuse
  hard-requires Postgres — it cannot run on Firestore. Verified at acceptance
  time: `langfuse_enabled` defaults to `false`, it is not set in
  `terraform.tfvars`, and no Compute Engine instance exists — so the production
  stack was already dormant and **nothing in use breaks**. We therefore delete
  the `google_sql_database.langfuse` resource and its Postgres wiring rather
  than carrying dead Terraform. Local `npm run evals` against the
  docker-compose overlay is unaffected and remains the supported way to run
  evals. **Re-enabling Langfuse in production now requires provisioning a
  Postgres for it first** (a Neon free project would serve that need well);
  ADR-0010, ADR-0011 and ADR-0012 are amended by this to that extent.
- **ADR-0003's migration-as-deploy-step no longer applies to cv-api.** Firestore
  is schemaless; the migration job and its SHA-pinned image step are removed for
  the main database, and schema evolution becomes a code-level concern with no
  enforcement point.
- **Query patterns must be designed, not inherited.** Firestore requires
  composite indexes for multi-field queries, has no joins, and bills per
  document read — so `.Include()`-style graph loading becomes several reads.
  Index entries also mean the 83 MB of Postgres data will not map 1:1 onto the
  1 GiB Firestore ceiling; actual stored size must be re-measured after import.
- **Correction, 2026-08-17: the aggregation-query argument does not apply to
  the usage limit.** The "Firestore capability checks" note above claims
  `UsageService.EnsureWithinLimitAsync` can sum `LlmUsage` cost with
  `AggregateField.Sum` and so needs no maintained counters. That is wrong, and
  it is recorded here rather than quietly dropped. Cost is not a stored column:
  `LlmUsage` holds only token counts and a model name, and `Summarize()`
  computes cost in application code from per-model pricing in configuration,
  including fallback multipliers for cache tokens. There is nothing for `Sum` to
  aggregate. The check therefore reads **every** usage row for the user on
  **every** LLM call, and that read count grows without bound as a user
  accumulates history — one heavy user eventually costs more reads per call than
  the whole rest of the system. It is implemented faithfully as-is, because
  changing it is a behaviour change and not part of the migration, but it is the
  migration's main per-read cost risk and the first thing to fix if the 50k/day
  read quota starts to bite. The fixes available are a maintained per-user
  counter, a stored cost field written at record time (which would make `Sum`
  genuinely usable), or a rollup document.
- **Daily quota rather than a monthly bill.** 50k reads / 20k writes per day is
  generous at current traffic but is a *rate* limit; a runaway loop or a
  backfill script can exhaust a day's quota in minutes.
- **What gets easier:** no NAT, no VPC path to the database, no database
  passwords in Secret Manager, no instance to stop or forget to stop, no tier to
  size, and ADR-0001's network privacy fully preserved.
- **Revisit if:** the rewrite's billing-path risk looks unacceptable at
  implementation time (fall back to Neon); stored size or daily quotas approach
  the free tier; Langfuse needs enabling in production; or real traffic makes
  per-read pricing and the loss of ad-hoc SQL painful.

## Pre-flight checks before implementing

1. ~~Measure real size against the storage ceiling.~~ Done: 83 MB in Postgres —
   but re-measure after import, since Firestore adds per-field and index overhead.
2. ~~Resolve the ADR-0009 discrepancy.~~ Done 2026-08-16: instance is
   `RUNNABLE` / `activationPolicy: ALWAYS`, billing continuously. The saving is
   real and the rewrite is justified on those grounds.
3. ~~Decide Langfuse's future before deleting Cloud SQL.~~ Done 2026-08-16:
   the production Langfuse Postgres path is dropped (see consequences).
4. Enable the Firestore API on `applysy-498807` — confirmed **not enabled** as
   of 2026-08-16 — and confirm the chosen location's availability and
   free-tier eligibility. Outstanding; this is the first implementation step.

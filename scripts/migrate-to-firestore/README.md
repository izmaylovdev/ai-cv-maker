# Cloud SQL → Firestore migration

The one-off export/transform/import that moves the `cvmaker` and `admin`
Postgres databases onto Firestore, per **ADR-0021 decision #7**. It runs once,
from a developer machine, through the Cloud SQL Auth Proxy. After the rollback
window closes and the Cloud SQL instance is deleted, this directory goes with
it.

Everything about the *shape* of the output is decided elsewhere. The authority
is `apps/cv-api/Infrastructure/Persistence/Firestore/FirestoreMapping.cs` (and
`apps/admin-api/src/app/database/firestore.ts` for `admin_users`). This tool
exists to produce exactly what those readers expect — if they change, change
this to match, not the other way round.

---

## The one thing to read before running anything

**Money is a string, and it is never parsed.**

`BillingAccount.AllowanceUsd` and `TopUpPayment.AmountUsd` are both
`decimal(18,6)`. Firestore has no decimal type — its only numeric types are
int64 and IEEE-754 double, and a double round trip is lossy at six decimal
places. For a balance, that is real money quietly drifting.

So cv-api stores money as an **invariant-culture decimal string**
(`FirestoreValues.FromDecimal` → `decimal.ToString(CultureInfo.InvariantCulture)`),
and this tool matches it in the strongest possible way: the columns are
`SELECT`ed as `::text` and the resulting string is handed to Firestore
untouched.

```sql
SELECT "AllowanceUsd"::text AS "AllowanceUsd" FROM "BillingAccounts"
```

Postgres renders `numeric(18,6)` as `12.500000`; .NET renders the same decimal
as `12.500000`. They are the same text, so the migration is a copy, not a
re-encoding. **No float, no double, no `Decimal`, no `int` — no numeric type
appears anywhere in the money path.** There is nothing to be lossy.

`money_text()` validates each value against `^-?\d+(\.\d+)?$` before writing it.
That regex is a tripwire, not a parser: if a value ever turns up in a shape
.NET's `decimal.Parse` would reject, the run stops.

## The other encodings

| Source | Firestore | Why |
|---|---|---|
| `Guid` | string, `"D"` format (lowercase, hyphenated) | Used for document ids *and* for fields referencing them, so an id and a foreign key compare equal as text. |
| `DateTime` (`timestamptz`) | UTC timestamp | Every timestamp column is `timestamp with time zone`, so psycopg returns an aware datetime; it is converted to UTC. A naive value would mean the schema changed and is logged loudly. |
| `Profile.Document` (`jsonb`) | JSON **string** field `document` | `SELECT "Document"::text` — the jsonb column's own serialization, copied verbatim. No parse, no re-serialize. (`jsonb` has never preserved key order or whitespace; what crosses is exactly the bytes Postgres already returns to EF today.) |
| `RefreshToken.Token` | document id **and** `token` field | See below. |

### Refresh-token document ids — the non-obvious one

ADR-0021 says `refreshTokens/{tokenHash}`. Taken literally, that is broken.
`AuthService.HashToken` returns *standard* base64 of a SHA-256 digest, and
base64's alphabet includes `/` — which Firestore treats as a path separator and
forbids in a document id. With 43 significant characters, roughly **half of all
refresh tokens** contain at least one.

The id is therefore the **base64url** form of the same hash (`+` → `-`,
`/` → `_`), matching `FirestoreDocumentIds.ForTokenHash`. It is a one-to-one
character substitution, so it stays collision-free and the lookup stays a single
keyed read with no query and no index. The unmodified hash is also written to
the `token` field, which is what cv-api actually reads.

If this tool and cv-api ever disagree on that substitution, half the refresh
tokens land on ids cv-api cannot compute and every session in flight dies at
cutover. It is the single most fragile agreement in the migration.

### Field naming

cv-api's collections are camelCase. **`admin_users` is snake_case** — admin-api's
`AdminUserDocument` kept the original Postgres column names (`password_hash`,
`google_id`, `created_at`). That inconsistency is deliberate on the reader's
side; this tool matches the reader rather than being tidy.

Ids carried by the document path are **not** duplicated into fields. A profile
has no `userId` field and a billing account has none either — both mappers read
the owner from `snapshot.Reference.Parent.Parent.Id`. Writing it anyway would
only buy index entries.

## Collection layout

Fixed by ADR-0021 decision #2 (the "Amended 2026-08-16 / 2026-08-17" block):

```
users/{userId}                        ← Users
users/{userId}/profiles/{profileId}   ← Profiles
users/{userId}/billing/account        ← BillingAccounts   (fixed document id)
generatedCvs/{cvId}                   ← GeneratedCvs
llmUsage/{id}                         ← LlmUsages         (userId nullable)
refreshTokens/{base64url tokenHash}   ← RefreshTokens
topUpPayments/{paymentId}             ← TopUpPayments
appSettings/{key}                     ← AppSettings       (id IS the key)
admin_users/{id}                      ← admin.admin_users
```

---

## Write count vs the free daily quota

Firestore's free tier allows **20,000 document writes per day**. ADR-0021 is
explicit that this is a *rate* limit, not a monthly total, and that a backfill
can exhaust a day's worth in minutes.

The arithmetic is simple: **one document = one write.** Batching does not change
the count — a 500-write `WriteBatch` is billed as 500 writes. So the total is
the sum of the row counts across the nine tables above, and nothing else.
Firestore does not bill for the index entries it derives, and the parent `users`
documents already exist, so subcollections cost nothing extra.

**The exact number for the real dataset comes from `--dry-run`, which prints it
per collection with a fits/does-not-fit verdict.** That is the number to record
here before the real run; this tool has never been pointed at production and
the figure below is an estimate, not a measurement.

The estimate, from what ADR-0021 does measure — 83 MB of Cloud SQL disk:

| | |
|---|---|
| Measured `database/disk/bytes_used` | 83 MB |
| Postgres cluster overhead (template0/1 + `postgres` system catalogs) | ~22 MB |
| Three application databases' base catalogs (`cvmaker`, `admin`, `langfuse`) | ~22 MB |
| WAL segments retained | ~16–48 MB |
| **Therefore application row data** | **plausibly under ~10 MB** |

83 MB is very nearly the empty-cluster floor. Almost all of it is Postgres
overhead, not rows. At a blended ~1 KB per document — `Profiles` carry the whole
`ProfileDocument` JSON and are the fat ones; everything else is a few hundred
bytes — that puts the real migration in the **low thousands of writes**.

**Verdict: one run is expected to fit comfortably inside a single day's free
quota, with the two caveats that (a) `LlmUsages` grows one row per LLM call and
is the only table that could plausibly be large, and (b) the estimate is
inferred from a disk figure rather than counted.** Do not skip the `--dry-run`.

Even in the worst case — if the entire 83 MB were application rows at 1 KB each,
~85,000 documents — the tool handles it: it refuses to start when the plan
exceeds the per-run budget, and `--allow-multi-day` makes it write up to the
budget, checkpoint, and resume the next day.

## Stored size vs the 1 GiB ceiling

ADR-0021 requires re-measuring stored size after import, because Firestore's
per-field and per-index overhead means 83 MB of Postgres does not map 1:1 onto
the 1 GiB free ceiling.

Two checks, and they answer different questions:

**Before the import — projection.** `--dry-run` samples each collection and
applies Firestore's documented size formula (document name + 32 bytes overhead +
each field's name and value), plus an estimate of the two built-in single-field
index entries per field. Index entries routinely cost more than the documents
themselves; that is the overhead the ADR warns about. This is a projection from
the source rows, and it is what tells you *before* writing whether the ceiling is
in play.

**After the import — measurement.** The authoritative number is the Firestore
console's **Usage** tab for `applysy-498807`, which reports actual stored bytes
including indexes:

```
https://console.cloud.google.com/firestore/databases/-default-/usage?project=applysy-498807
```

Record that number in the ADR's pre-flight check #1, which is currently marked
"re-measure after import". If it is anywhere near 1 GiB, the lever is index
exemptions — most of these fields are never queried on and their built-in
indexes are pure cost.

---

## Running it

### Prerequisites

```sh
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
```

Start the Cloud SQL Auth Proxy against the (temporarily started) instance:

```sh
cloud-sql-proxy applysy-498807:europe-central2:ai-cv-maker-postgres --port 5432
```

```sh
export MAIN_DSN='postgresql://USER:PASSWORD@127.0.0.1:5432/cvmaker'
export ADMIN_DSN='postgresql://USER:PASSWORD@127.0.0.1:5432/admin'
```

### 1. Rehearse against the emulator — not optional

The Firestore client library routes itself to the emulator purely on
`FIRESTORE_EMULATOR_HOST`, so the rehearsal runs the same code against the same
local emulator cv-api develops against, with no flags and no code change.

```sh
docker compose up -d --wait firestore

export FIRESTORE_EMULATOR_HOST=localhost:8085
export GOOGLE_CLOUD_PROJECT=applysy-local

python migrate.py --dry-run      # plan, quota verdict, size projection
python migrate.py                # import
python migrate.py --verify       # per-collection count comparison
python migrate.py --restart      # again — proves it is idempotent
python migrate.py --verify       # same counts, no duplicates
```

Then point a local cv-api at the emulator and exercise sign-in (refresh-token
ids), a profile load (the JSON string), and a top-up confirmation (the money
strings) before going anywhere near production.

### 2. The real run

```sh
unset FIRESTORE_EMULATOR_HOST          # ← the safety catch. Do this deliberately.
export GOOGLE_CLOUD_PROJECT=applysy-498807

python migrate.py --dry-run            # record the write count in this README
python migrate.py
python migrate.py --verify
```

The tool prints its target on every run — `emulator at …` or
`REAL Firestore in …`. Read that line before answering any prompt.

### If the plan exceeds a day's quota

```sh
python migrate.py --allow-multi-day    # writes up to the budget, then checkpoints
# ...next day...
python migrate.py --allow-multi-day    # resumes from the checkpoint
```

`--writes-per-second N` throttles, which is worth doing on the real run even
when the total fits: it keeps the burst well clear of Firestore's per-second
limits and leaves headroom for the live service.

## The checkpoint survives a change of target — clear it between runs

**Hit for real during the production cutover on 2026-08-17.** The checkpoint
file records progress per collection but records *nothing about which Firestore
it was written to*. The runbook above tells you to rehearse against the emulator
first, so by the time you reach the real run the checkpoint says every
collection is finished — and the real run reports `Done: 0 of 109 documents
written` and exits successfully, having written nothing at all.

Always pass `--restart` on the first real run, or delete
`.migrate-checkpoint.json` after the rehearsal:

```sh
python migrate.py --restart          # discards the rehearsal's checkpoint
```

`--verify` is what catches this — it compares against the target you are
actually pointed at, so it reported every collection as MISMATCH while the
import claimed success. Run it after every import, and do not read a `Done:`
line as proof that anything was written.

## How re-running stays safe

Two mechanisms, and they are independent:

- **Deterministic ids.** Every document id is derived from source data — a Guid,
  a setting key, a token hash — never generated. Every write is a full `set()`
  with no merge. Re-running rewrites identical content, so a run killed halfway
  converges rather than duplicating. This is what makes correctness safe.
- **A checkpoint file.** `.migrate-checkpoint.json` records the last primary key
  written per collection, and reads resume with keyset pagination
  (`WHERE pk > last ORDER BY pk`), a single indexed seek. This is what makes
  resuming *cheap*, which is what matters when the budget is 20,000 writes a
  day. `--restart` discards it.

## Flags

| Flag | Default | |
|---|---|---|
| `--dry-run` | | Plan, quota verdict and size projection. Writes nothing. |
| `--verify` | | Compare Postgres `count(*)` against Firestore `count()` per collection. Costs a handful of reads, not one per document. |
| `--only NAME…` | all | Restrict to named collections. |
| `--batch-size` | 500 | Writes per `WriteBatch`. Firestore's hard cap is 500. |
| `--page-size` | 1000 | Rows per Postgres keyset page. |
| `--max-writes-per-run` | 20000 | Stop after this many writes. Defaults to the free daily quota. |
| `--allow-multi-day` | off | Proceed when the plan exceeds the budget, stopping at it. Without this, an over-budget plan refuses to start (exit 2). |
| `--writes-per-second` | 0 | Throttle. 0 disables. |
| `--checkpoint` | `.migrate-checkpoint.json` | Resume state. |
| `--restart` | | Discard the checkpoint. |
| `--sample-size` | 200 | Documents sampled per collection for the size projection. |

## After cutover

Per ADR-0021 decision #7 the Cloud SQL instance is **stopped, not deleted**, for
one rollback window. Deleting it is what retires this directory.

Note that the ADR's rollback story is asymmetric: rolling back to Postgres after
cutover means reversing this migration *and* the persistence rewrite. This tool
is one-directional by design — there is no `--reverse`. If the rollback window
is ever exercised, the answer is the retained Cloud SQL instance, not a
Firestore export.

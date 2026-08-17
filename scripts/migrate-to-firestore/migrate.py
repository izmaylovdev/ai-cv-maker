#!/usr/bin/env python3
"""One-off Cloud SQL -> Firestore migration (ADR-0021 decision #7).

Reads the `cvmaker` and `admin` Postgres databases through the Cloud SQL Auth
Proxy and writes them into the single Firestore database, using the collection
layout fixed by ADR-0021 decision #2 (the "Amended 2026-08-16 / 2026-08-17"
block).

Design constraints, all of them load-bearing — see README.md:

  * Idempotent. Every document id is derived from source data, never generated,
    and every write is a full `set()`. Re-running overwrites with identical
    content, so a run interrupted halfway is safe to repeat.
  * Batched. Firestore caps a WriteBatch at 500 writes.
  * Quota-aware. The free tier allows 20,000 document writes per *day* — a rate
    limit, not a monthly total. The tool counts the plan up front, refuses to
    exceed a per-run budget, and checkpoints so the next day resumes where it
    stopped.
  * Verifiable. `--dry-run` plans without writing and projects stored bytes
    against the 1 GiB free ceiling; `--verify` compares per-collection counts
    afterwards.

The document shapes here are not this script's to choose. cv-api's
FirestoreMapping.cs and admin-api's database/firestore.ts are the authority for
every collection name, field name and encoding; this tool exists to produce
exactly what they read.

Run `python migrate.py --help`, and read README.md before pointing this at
anything real.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Callable, Iterable, Iterator, Sequence

try:
    import psycopg
    from psycopg.rows import dict_row
except ImportError:  # pragma: no cover - guidance, not logic
    sys.exit("psycopg is not installed. See README.md: pip install -r requirements.txt")

from google.cloud import firestore

# --------------------------------------------------------------------------
# Constants
# --------------------------------------------------------------------------

#: Firestore's hard cap on writes in one WriteBatch / transaction.
FIRESTORE_BATCH_LIMIT = 500

#: Free-tier document writes per day. A *rate* limit, not a monthly allowance:
#: ADR-0021 warns explicitly that a backfill can burn a day's worth in minutes.
FREE_TIER_WRITES_PER_DAY = 20_000

#: Free-tier stored bytes (1 GiB).
FREE_TIER_STORED_BYTES = 1024 ** 3

#: The two money columns are decimal(18,6). They are SELECTed as ::text and
#: copied across untouched — see money_text() and README.md.
MONEY_SCALE = 6

#: What an invariant-culture decimal looks like: optional sign, digits, optional
#: fractional part. No thousands separators, no exponent, no culture.
_MONEY_RE = re.compile(r"^-?\d+(\.\d+)?$")

#: Firestore document-id rules we must not violate.
_RESERVED_ID_RE = re.compile(r"^__.*__$")


# --------------------------------------------------------------------------
# Type mapping — the rules cv-api's Firestore repositories must agree with
# --------------------------------------------------------------------------


def guid_to_str(value: uuid.UUID | str | None) -> str | None:
    """Guid -> string in .NET's "D" format (lowercase, hyphenated, no braces).

    `str(uuid.UUID(...))` is exactly "D", which is also what
    `Guid.ToString("D")` and `Guid.Parse` round-trip through on the .NET side.
    """
    if value is None:
        return None
    if isinstance(value, uuid.UUID):
        return str(value)
    return str(uuid.UUID(str(value)))


def utc(value: datetime | None) -> datetime | None:
    """DateTime -> UTC timestamp.

    Every timestamp column in the schema is `timestamp with time zone`, so
    psycopg hands back an aware datetime. A naive value would mean the schema
    changed under us; treat it as UTC (that is what EF wrote) but say so.
    """
    if value is None:
        return None
    if value.tzinfo is None:
        print(f"  ! naive datetime {value!r}; assuming UTC", file=sys.stderr)
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def money_text(value: str | None) -> str | None:
    """decimal(18,6) -> invariant-culture decimal string, copied verbatim.

    This is the one conversion that is deliberately *not* a conversion. cv-api
    stores money as `decimal.ToString(CultureInfo.InvariantCulture)`
    (FirestoreValues.FromDecimal) because Firestore has no decimal type and its
    only numeric types are int64 and IEEE-754 double — and a double round trip
    is lossy at six decimal places, which for a balance means real money quietly
    drifting.

    Postgres renders numeric(18,6) as exactly the same text ("12.500000"), so
    the column is SELECTed as ::text and the string is handed to Firestore
    without ever becoming a Python float, Decimal, or anything else. There is no
    numeric parsing anywhere in this pipeline, which means there is nothing to
    be lossy.

    The regex is a tripwire, not a parser: if a value ever arrives in a shape
    .NET's decimal.Parse would not accept, stop rather than write it.
    """
    if value is None:
        return None
    if not isinstance(value, str):
        raise TypeError(
            f"money column came back as {type(value).__name__}, not str — the column "
            "must be SELECTed as ::text so it never passes through a number"
        )
    if not _MONEY_RE.match(value):
        raise ValueError(f"money value {value!r} is not an invariant-culture decimal")
    return value


def refresh_token_doc_id(token_hash: str) -> str:
    """RefreshToken.Token (the SHA-256 hash) -> a legal Firestore document id.

    AuthService.HashToken returns *standard* base64 of the SHA-256 digest, which
    contains '/' for roughly half of all tokens. '/' is the Firestore path
    separator and is illegal in a document id, so the hash cannot be used raw
    despite what ADR-0021's layout block implies.

    The id is the base64url form of the same hash ('+' -> '-', '/' -> '_') — a
    one-to-one character substitution, so it stays collision-free and the lookup
    stays a keyed read. The untouched hash is also kept in the `token` field.

    This mirrors FirestoreDocumentIds.ForTokenHash in
    apps/cv-api/Infrastructure/Persistence/Firestore/FirestoreMapping.cs, which
    is the authority. If the two ever diverge, roughly half of all refresh
    tokens land on ids cv-api cannot compute, and every session in flight dies
    at cutover.
    """
    return token_hash.replace("+", "-").replace("/", "_")


def check_doc_id(doc_id: str, where: str) -> str:
    """Fail loudly rather than write a document under a mangled path."""
    if not doc_id:
        raise ValueError(f"{where}: empty document id")
    if "/" in doc_id:
        raise ValueError(f"{where}: document id contains '/': {doc_id!r}")
    if doc_id in (".", ".."):
        raise ValueError(f"{where}: document id is '.' or '..'")
    if _RESERVED_ID_RE.match(doc_id):
        raise ValueError(f"{where}: document id matches the reserved __*__ pattern: {doc_id!r}")
    if len(doc_id.encode("utf-8")) > 1500:
        raise ValueError(f"{where}: document id exceeds 1500 bytes")
    return doc_id


# --------------------------------------------------------------------------
# Collection specs — one per table, mirroring ADR-0021 decision #2
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class Spec:
    """How one Postgres table becomes one Firestore collection."""

    name: str  # label used in logs, checkpoints and the count report
    database: str  # "main" (cvmaker) or "admin"
    table: str  # quoted Postgres table name
    key_column: str  # primary key, used for stable keyset pagination
    columns: Sequence[str]  # columns to SELECT, in order
    path: Callable[[dict[str, Any], "Options"], list[str]]  # -> Firestore path segments
    fields: Callable[[dict[str, Any], "Options"], dict[str, Any]]  # -> document body
    #: Collection id used by --verify. Sub-collections are counted with a
    #: collection-group query, which is why the leaf id is recorded separately.
    collection_id: str = ""
    collection_group: bool = False
    notes: str = ""


def _users_path(row, _o):
    return ["users", check_doc_id(guid_to_str(row["Id"]), "users")]


def _users_fields(row, _o):
    return {
        "email": row["Email"],
        "passwordHash": row["PasswordHash"],
        "googleId": row["GoogleId"],
        "createdAt": utc(row["CreatedAt"]),
        "globalPreferences": row["GlobalPreferences"],
        "country": row["Country"],
    }


def _profiles_path(row, _o):
    return [
        "users",
        check_doc_id(guid_to_str(row["UserId"]), "users"),
        "profiles",
        check_doc_id(guid_to_str(row["Id"]), "profiles"),
    ]


def _profiles_fields(row, _o):
    # Document is SELECTed as ::text, so this is the jsonb column's own
    # serialization copied across verbatim — no parse, no re-serialize.
    # No userId field: FirestoreMappers.ToProfile reads the owner from
    # snapshot.Reference.Parent.Parent.Id, so the path is the only source of
    # truth for it and duplicating it would just buy index entries.
    return {
        "name": row["Name"],
        "document": row["Document"],
    }


def _billing_path(row, _o):
    # Fixed document id: one billing account per user, so "does this user have
    # one?" stays a keyed read rather than a query (ADR-0021 decision #2).
    return [
        "users",
        check_doc_id(guid_to_str(row["UserId"]), "users"),
        "billing",
        "account",
    ]


def _billing_fields(row, _o):
    # As with profiles, the owning user is the grandparent document id, not a
    # field (FirestoreMappers.ToBillingAccount).
    return {
        "id": guid_to_str(row["Id"]),
        "allowanceUsd": money_text(row["AllowanceUsd"]),
        "currency": row["Currency"],
        "updatedAt": utc(row["UpdatedAt"]),
    }


def _generated_cvs_path(row, _o):
    return ["generatedCvs", check_doc_id(guid_to_str(row["Id"]), "generatedCvs")]


def _generated_cvs_fields(row, _o):
    return {
        "profileId": guid_to_str(row["ProfileId"]),
        "createdAt": utc(row["CreatedAt"]),
        "optimizationNotes": row["OptimizationNotes"],
        "fullName": row["FullName"],
        "title": row["Title"],
        "location": row["Location"],
        "contactEmail": row["ContactEmail"],
        "contactPhone": row["ContactPhone"],
        "cvDataJson": row["CvDataJson"],
    }


def _llm_usage_path(row, _o):
    return ["llmUsage", check_doc_id(guid_to_str(row["Id"]), "llmUsage")]


def _llm_usage_fields(row, _o):
    # userId stays a nullable field rather than a path segment: unattributed
    # usage rows exist and must survive (ADR-0021 decision #2).
    return {
        "userId": guid_to_str(row["UserId"]),
        "operation": row["Operation"],
        "promptTokens": row["PromptTokens"],
        "completionTokens": row["CompletionTokens"],
        "cacheReadTokens": row["CacheReadTokens"],
        "cacheWriteTokens": row["CacheWriteTokens"],
        "modelName": row["ModelName"],
        "createdAt": utc(row["CreatedAt"]),
    }


def _refresh_tokens_path(row, _o):
    return ["refreshTokens", check_doc_id(refresh_token_doc_id(row["Token"]), "refreshTokens")]


def _refresh_tokens_fields(row, _o):
    return {
        "id": guid_to_str(row["Id"]),
        "userId": guid_to_str(row["UserId"]),
        # The untouched base64 hash. cv-api reads this field (FirestoreFields.Token)
        # rather than reversing the document id's encoding.
        "token": row["Token"],
        "expiresAt": utc(row["ExpiresAt"]),
        "createdAt": utc(row["CreatedAt"]),
        "isRevoked": row["IsRevoked"],
    }


def _top_up_payments_path(row, _o):
    return ["topUpPayments", check_doc_id(guid_to_str(row["Id"]), "topUpPayments")]


def _top_up_payments_fields(row, _o):
    return {
        "userId": guid_to_str(row["UserId"]),
        "amountUsd": money_text(row["AmountUsd"]),
        "channel": row["Channel"],
        "status": row["Status"],
        "externalId": row["ExternalId"],
        "createdAt": utc(row["CreatedAt"]),
        "updatedAt": utc(row["UpdatedAt"]),
    }


def _app_settings_path(row, _o):
    # The setting key IS the document id (ADR-0021 decision #2).
    return ["appSettings", check_doc_id(row["Key"], "appSettings")]


def _app_settings_fields(row, _o):
    return {"value": row["Value"], "updatedAt": utc(row["UpdatedAt"])}


def _admin_users_path(row, _o):
    return ["admin_users", check_doc_id(guid_to_str(row["id"]), "admin_users")]


def _admin_users_fields(row, _o):
    # NOTE the casing: admin-api's AdminUserDocument
    # (apps/admin-api/src/app/database/firestore.ts) kept the original Postgres
    # column names, so this collection is snake_case where every cv-api
    # collection is camelCase. Matching the reader beats being consistent.
    return {
        "email": row["email"],
        "password_hash": row["password_hash"],
        "google_id": row["google_id"],
        "created_at": utc(row["created_at"]),
    }


SPECS: list[Spec] = [
    Spec(
        name="users",
        database="main",
        table='"Users"',
        key_column='"Id"',
        columns=['"Id"', '"Email"', '"PasswordHash"', '"GoogleId"', '"CreatedAt"',
                 '"GlobalPreferences"', '"Country"'],
        path=_users_path,
        fields=_users_fields,
        collection_id="users",
    ),
    Spec(
        name="profiles",
        database="main",
        table='"Profiles"',
        key_column='"Id"',
        # ::text keeps Profile.Document a verbatim JSON string end to end.
        columns=['"Id"', '"UserId"', '"Name"', '"Document"::text AS "Document"'],
        path=_profiles_path,
        fields=_profiles_fields,
        collection_id="profiles",
        collection_group=True,
        notes="subcollection of users/{userId}",
    ),
    Spec(
        name="billingAccounts",
        database="main",
        table='"BillingAccounts"',
        key_column='"Id"',
        columns=['"Id"', '"UserId"', '"AllowanceUsd"::text AS "AllowanceUsd"',
                 '"Currency"', '"UpdatedAt"'],
        path=_billing_path,
        fields=_billing_fields,
        collection_id="billing",
        collection_group=True,
        notes="users/{userId}/billing/account — fixed document id",
    ),
    Spec(
        name="generatedCvs",
        database="main",
        table='"GeneratedCvs"',
        key_column='"Id"',
        columns=['"Id"', '"ProfileId"', '"CreatedAt"', '"OptimizationNotes"', '"FullName"',
                 '"Title"', '"Location"', '"ContactEmail"', '"ContactPhone"', '"CvDataJson"'],
        path=_generated_cvs_path,
        fields=_generated_cvs_fields,
        collection_id="generatedCvs",
    ),
    Spec(
        name="llmUsage",
        database="main",
        table='"LlmUsages"',
        key_column='"Id"',
        columns=['"Id"', '"UserId"', '"Operation"', '"PromptTokens"', '"CompletionTokens"',
                 '"CacheReadTokens"', '"CacheWriteTokens"', '"ModelName"', '"CreatedAt"'],
        path=_llm_usage_path,
        fields=_llm_usage_fields,
        collection_id="llmUsage",
    ),
    Spec(
        name="refreshTokens",
        database="main",
        table='"RefreshTokens"',
        key_column='"Id"',
        columns=['"Id"', '"UserId"', '"Token"', '"ExpiresAt"', '"CreatedAt"', '"IsRevoked"'],
        path=_refresh_tokens_path,
        fields=_refresh_tokens_fields,
        collection_id="refreshTokens",
        notes="document id is the (url-safe) token hash",
    ),
    Spec(
        name="topUpPayments",
        database="main",
        table='"TopUpPayments"',
        key_column='"Id"',
        columns=['"Id"', '"UserId"', '"AmountUsd"::text AS "AmountUsd"', '"Channel"',
                 '"Status"', '"ExternalId"', '"CreatedAt"', '"UpdatedAt"'],
        path=_top_up_payments_path,
        fields=_top_up_payments_fields,
        collection_id="topUpPayments",
    ),
    Spec(
        name="appSettings",
        database="main",
        table='"AppSettings"',
        key_column='"Key"',
        columns=['"Key"', '"Value"', '"UpdatedAt"'],
        path=_app_settings_path,
        fields=_app_settings_fields,
        collection_id="appSettings",
        notes="document id is the setting key",
    ),
    Spec(
        name="admin_users",
        database="admin",
        table="admin_users",
        key_column="id",
        columns=["id", "email", "password_hash", "google_id", "created_at"],
        path=_admin_users_path,
        fields=_admin_users_fields,
        collection_id="admin_users",
    ),
]


# --------------------------------------------------------------------------
# Options — the representation choices, resolved once
# --------------------------------------------------------------------------


@dataclass
class Options:
    """Deliberately empty.

    An earlier draft made the money representation and the refresh-token id
    encoding switchable, because cv-api's repositories were being written at the
    same time and could have landed on either. They landed
    (FirestoreMapping.cs), both decisions are fixed, and a switch here would only
    be a way to produce data cv-api cannot read. The parameter stays threaded
    through the spec functions so the seam exists if a future migration needs it.
    """


# --------------------------------------------------------------------------
# Stored-size estimation (ADR-0021: 83 MB of Postgres will not map 1:1 onto the
# 1 GiB Firestore ceiling, so size must be re-measured)
# --------------------------------------------------------------------------


def _value_size(value: Any) -> int:
    """Firestore's documented per-value storage size, in bytes."""
    if value is None or isinstance(value, bool):
        return 1
    if isinstance(value, int):
        return 8
    if isinstance(value, float):
        return 8
    if isinstance(value, datetime):
        return 8
    if isinstance(value, str):
        return len(value.encode("utf-8")) + 1
    if isinstance(value, bytes):
        return len(value)
    if isinstance(value, (list, tuple)):
        return sum(_value_size(v) for v in value)
    if isinstance(value, dict):
        return sum(len(k.encode("utf-8")) + 1 + _value_size(v) for k, v in value.items())
    return len(str(value).encode("utf-8")) + 1


def document_size(path: Sequence[str], fields: dict[str, Any]) -> tuple[int, int]:
    """(document bytes, estimated index-entry bytes) for one document.

    Document size = name size + sum(field name + value) + 32 bytes of overhead.
    Index size is the coarse part: Firestore keeps two built-in single-field
    index entries (ascending + descending) per indexable field, each costing
    roughly the document name plus the field name and value plus 32 bytes. That
    is the overhead ADR-0021 warns about, and it routinely doubles or triples
    the raw document total.
    """
    name_size = sum(len(seg.encode("utf-8")) + 1 for seg in path) + 16
    doc = name_size + 32
    index = 0
    for key, value in fields.items():
        key_size = len(key.encode("utf-8")) + 1
        val_size = _value_size(value)
        doc += key_size + val_size
        index += 2 * (name_size + key_size + val_size + 32)
    return doc, index


# --------------------------------------------------------------------------
# Postgres reading
# --------------------------------------------------------------------------


def _key_of(row: dict[str, Any], spec: Spec) -> Any:
    """Value of the primary key in a fetched row (column names come back unquoted)."""
    return row[spec.key_column.replace('"', "")]


def iter_rows(conn, spec: Spec, page_size: int, after: Any = None) -> Iterator[dict[str, Any]]:
    """Keyset pagination over one table, ordered by its primary key.

    Keyset rather than OFFSET so that resuming from a checkpoint is a single
    indexed seek and so the stream never re-reads rows it already wrote.
    """
    cols = ", ".join(spec.columns)
    while True:
        if after is None:
            sql = f"SELECT {cols} FROM {spec.table} ORDER BY {spec.key_column} LIMIT %s"
            params: tuple = (page_size,)
        else:
            sql = (
                f"SELECT {cols} FROM {spec.table} WHERE {spec.key_column} > %s "
                f"ORDER BY {spec.key_column} LIMIT %s"
            )
            params = (after, page_size)
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(sql, params)
            rows = cur.fetchall()
        if not rows:
            return
        for row in rows:
            yield row
        if len(rows) < page_size:
            return
        after = _key_of(rows[-1], spec)


def count_rows(conn, spec: Spec) -> int:
    with conn.cursor() as cur:
        cur.execute(f"SELECT count(*) FROM {spec.table}")
        return cur.fetchone()[0]


# --------------------------------------------------------------------------
# Checkpointing
# --------------------------------------------------------------------------


class Checkpoint:
    """Records the last primary key written per collection.

    Deterministic ids already make a re-run safe; the checkpoint makes it
    *cheap*, which is what matters when the budget is 20,000 writes a day.
    """

    def __init__(self, path: str):
        self.path = path
        self.data: dict[str, str] = {}
        if os.path.exists(path):
            with open(path) as fh:
                self.data = json.load(fh)

    def get(self, name: str) -> Any:
        return self.data.get(name)

    def set(self, name: str, key: Any) -> None:
        self.data[name] = str(key)
        tmp = self.path + ".tmp"
        with open(tmp, "w") as fh:
            json.dump(self.data, fh, indent=2, sort_keys=True)
        os.replace(tmp, self.path)

    def clear(self) -> None:
        self.data = {}
        if os.path.exists(self.path):
            os.remove(self.path)


# --------------------------------------------------------------------------
# Migration
# --------------------------------------------------------------------------


@dataclass
class Stats:
    planned: int = 0
    written: int = 0
    doc_bytes: int = 0
    index_bytes: int = 0
    per_collection: dict[str, int] = field(default_factory=dict)


def migrate(args, opts: Options) -> Stats:
    conns = {"main": psycopg.connect(args.main_dsn)}
    if any(s.database == "admin" for s in SPECS):
        conns["admin"] = psycopg.connect(args.admin_dsn)

    db = None if args.dry_run else firestore.Client(project=args.project)
    checkpoint = Checkpoint(args.checkpoint)
    if args.restart:
        checkpoint.clear()

    stats = Stats()
    budget = args.max_writes_per_run

    # ---- plan first, so the quota verdict is known before anything is written
    plan: dict[str, int] = {}
    for spec in SPECS:
        if args.only and spec.name not in args.only:
            continue
        plan[spec.name] = count_rows(conns[spec.database], spec)
    total = sum(plan.values())
    stats.planned = total
    stats.per_collection = plan

    print("\nPlanned writes (1 document = 1 write):")
    for spec in SPECS:
        if spec.name in plan:
            note = f"   ({spec.notes})" if spec.notes else ""
            print(f"  {spec.name:<16} {plan[spec.name]:>9,}{note}")
    print(f"  {'TOTAL':<16} {total:>9,}")
    print(report_quota(total, budget))

    if args.dry_run:
        estimate_size_dry_run(conns, plan, opts, stats, args)
        for c in conns.values():
            c.close()
        return stats

    if total > budget and not args.allow_multi_day:
        print(
            f"\nRefusing to start: the plan needs {total:,} writes but the per-run budget is "
            f"{budget:,}. Either raise --max-writes-per-run, or pass --allow-multi-day to "
            "write up to the budget now and resume tomorrow from the checkpoint.",
            file=sys.stderr,
        )
        sys.exit(2)

    interval = 1.0 / args.writes_per_second if args.writes_per_second else 0.0

    for spec in SPECS:
        if spec.name not in plan:
            continue
        after = checkpoint.get(spec.name)
        if after is not None:
            print(f"\n[{spec.name}] resuming after key {after}")
        else:
            print(f"\n[{spec.name}] starting")

        batch = db.batch()
        pending = 0
        last_key = None
        written_here = 0

        for row in iter_rows(conns[spec.database], spec, args.page_size, after):
            if stats.written >= budget:
                break
            path = spec.path(row, opts)
            fields = spec.fields(row, opts)
            d, i = document_size(path, fields)
            stats.doc_bytes += d
            stats.index_bytes += i

            ref = db.document("/".join(path))
            # set() with no merge: a full overwrite, which is what makes a
            # partial re-run converge on the same state rather than accumulate.
            batch.set(ref, fields)
            pending += 1
            last_key = _key_of(row, spec)

            if pending >= args.batch_size:
                batch.commit()
                stats.written += pending
                written_here += pending
                checkpoint.set(spec.name, last_key)
                print(f"  [{spec.name}] {written_here:,}/{plan[spec.name]:,}", end="\r")
                batch = db.batch()
                pending = 0
                if interval:
                    time.sleep(interval * args.batch_size)

        if pending:
            batch.commit()
            stats.written += pending
            written_here += pending
            checkpoint.set(spec.name, last_key)

        print(f"  [{spec.name}] {written_here:,}/{plan[spec.name]:,} written")

        if stats.written >= budget:
            print(
                f"\nPer-run write budget of {budget:,} reached. Progress is checkpointed in "
                f"{args.checkpoint}; re-run tomorrow to continue.",
            )
            break

    for c in conns.values():
        c.close()
    return stats


def estimate_size_dry_run(conns, plan, opts: Options, stats: Stats, args) -> None:
    """Project stored size by sizing a sample of each collection's documents."""
    print("\nStored-size projection (sampled — ADR-0021 requires re-measuring after import):")
    total_doc = 0
    total_index = 0
    for spec in SPECS:
        if spec.name not in plan or plan[spec.name] == 0:
            continue
        sample_doc = sample_index = sampled = 0
        for row in iter_rows(conns[spec.database], spec, args.sample_size):
            d, i = document_size(spec.path(row, opts), spec.fields(row, opts))
            sample_doc += d
            sample_index += i
            sampled += 1
            if sampled >= args.sample_size:
                break
        if not sampled:
            continue
        n = plan[spec.name]
        proj_doc = sample_doc / sampled * n
        proj_index = sample_index / sampled * n
        total_doc += proj_doc
        total_index += proj_index
        print(
            f"  {spec.name:<16} {n:>9,} docs  ~{proj_doc / 1e6:>8.2f} MB docs "
            f"+ ~{proj_index / 1e6:>8.2f} MB indexes  (avg {sample_doc / sampled:,.0f} B/doc)"
        )
    stats.doc_bytes = int(total_doc)
    stats.index_bytes = int(total_index)
    grand = total_doc + total_index
    pct = grand / FREE_TIER_STORED_BYTES * 100
    print(
        f"  {'TOTAL':<16} {'':>9}       ~{grand / 1e6:.2f} MB "
        f"({pct:.1f}% of the 1 GiB free ceiling)"
    )
    print(
        "  NOTE: this is a projection from the source rows, not a measurement. The "
        "authoritative post-import number is the Firestore console's Usage tab — see "
        "the runbook in README.md."
    )


def report_quota(total: int, budget: int) -> str:
    days = -(-total // FREE_TIER_WRITES_PER_DAY)  # ceil
    if total <= FREE_TIER_WRITES_PER_DAY:
        verdict = (
            f"FITS in one day: {total:,} writes vs the free tier's "
            f"{FREE_TIER_WRITES_PER_DAY:,} writes/day."
        )
    else:
        verdict = (
            f"DOES NOT FIT in one day: {total:,} writes vs the free tier's "
            f"{FREE_TIER_WRITES_PER_DAY:,} writes/day — {days} days, or accept the "
            "overage charge for a single run."
        )
    return f"\nQuota: {verdict}\n       Per-run budget is {budget:,} writes."


# --------------------------------------------------------------------------
# Verification
# --------------------------------------------------------------------------


def verify(args, opts: Options) -> int:
    """Compare per-collection document counts against the source row counts.

    Uses Firestore's server-side count() aggregation, so this costs a handful of
    reads rather than one per document.
    """
    conns = {"main": psycopg.connect(args.main_dsn)}
    if any(s.database == "admin" for s in SPECS):
        conns["admin"] = psycopg.connect(args.admin_dsn)
    db = firestore.Client(project=args.project)

    print("\nVerification (Postgres rows vs Firestore documents):")
    failures = 0
    for spec in SPECS:
        if args.only and spec.name not in args.only:
            continue
        expected = count_rows(conns[spec.database], spec)
        query = (
            db.collection_group(spec.collection_id)
            if spec.collection_group
            else db.collection(spec.collection_id)
        )
        actual = query.count().get()[0][0].value
        ok = "OK " if actual == expected else "MISMATCH"
        if actual != expected:
            failures += 1
        print(f"  {ok} {spec.name:<16} postgres={expected:>9,}  firestore={actual:>9,}")

    for c in conns.values():
        c.close()
    if failures:
        print(f"\n{failures} collection(s) do not match.", file=sys.stderr)
    else:
        print("\nAll collections match.")
    return 1 if failures else 0


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="One-off Cloud SQL -> Firestore migration (ADR-0021).",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    p.add_argument(
        "--main-dsn",
        default=os.environ.get(
            "MAIN_DSN", "postgresql://postgres@127.0.0.1:5432/cvmaker"
        ),
        help="libpq DSN for the cvmaker database (via the Cloud SQL Auth Proxy).",
    )
    p.add_argument(
        "--admin-dsn",
        default=os.environ.get("ADMIN_DSN", "postgresql://postgres@127.0.0.1:5432/admin"),
        help="libpq DSN for the admin database.",
    )
    p.add_argument(
        "--project",
        default=os.environ.get("GOOGLE_CLOUD_PROJECT", "applysy-498807"),
        help="Firestore project id. Set FIRESTORE_EMULATOR_HOST to target the emulator.",
    )
    p.add_argument("--dry-run", action="store_true",
                   help="Plan and size the migration without writing anything.")
    p.add_argument("--verify", action="store_true",
                   help="Compare row counts per collection and exit.")
    p.add_argument("--only", nargs="*", metavar="COLLECTION",
                   help="Restrict to these collection names.")
    p.add_argument("--batch-size", type=int, default=FIRESTORE_BATCH_LIMIT,
                   help=f"Writes per WriteBatch (Firestore caps this at {FIRESTORE_BATCH_LIMIT}).")
    p.add_argument("--page-size", type=int, default=1000,
                   help="Rows fetched from Postgres per keyset page.")
    p.add_argument("--max-writes-per-run", type=int, default=FREE_TIER_WRITES_PER_DAY,
                   help="Stop after this many writes. Defaults to the free daily quota.")
    p.add_argument("--allow-multi-day", action="store_true",
                   help="Proceed when the plan exceeds the budget, stopping at the budget.")
    p.add_argument("--writes-per-second", type=float, default=0.0,
                   help="Throttle, in writes/second. 0 disables throttling.")
    p.add_argument("--checkpoint", default=os.environ.get("CHECKPOINT", ".migrate-checkpoint.json"),
                   help="Checkpoint file recording the last key written per collection.")
    p.add_argument("--restart", action="store_true",
                   help="Discard the checkpoint and start from the beginning.")
    p.add_argument("--sample-size", type=int, default=200,
                   help="Documents sampled per collection for the size projection.")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.batch_size > FIRESTORE_BATCH_LIMIT:
        sys.exit(f"--batch-size cannot exceed Firestore's limit of {FIRESTORE_BATCH_LIMIT}")

    opts = Options()

    emulator = os.environ.get("FIRESTORE_EMULATOR_HOST")
    target = f"emulator at {emulator}" if emulator else f"REAL Firestore in {args.project}"
    print(f"Target: {target}")
    print("Mapping: apps/cv-api/Infrastructure/Persistence/Firestore/FirestoreMapping.cs")

    if args.verify:
        return verify(args, opts)

    stats = migrate(args, opts)
    if not args.dry_run:
        print(f"\nDone: {stats.written:,} of {stats.planned:,} documents written.")
        print("Re-run with --verify to compare counts, and check the Firestore console's "
              "Usage tab for the authoritative stored size (ADR-0021).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Fixture loading and Langfuse dataset sync (ADR-0012).

Fixtures live in ``evals/fixtures/*.jsonl`` and are the source of truth. On each
run they are upserted into a Langfuse dataset named ``eval-<operation>`` with a
content-derived stable id, so re-runs dedupe rather than duplicate.
"""

from __future__ import annotations

import hashlib
import json
import pathlib
from typing import Any

# Fixture fields that are ground truth for evaluators rather than target inputs.
# They are split out of ``input`` (so ``target(**input)`` stays valid) and placed
# in the dataset item's ``expected_output``.
EXPECTED_FIELDS = ("expected_name", "expected_work_count", "expected_edu_count")

DATASET_PREFIX = "eval-"


def dataset_name(operation: str) -> str:
    return f"{DATASET_PREFIX}{operation}"


def load_cases(path: pathlib.Path) -> list[dict[str, Any]]:
    """Parse a fixtures file into a list of case dicts.

    Tolerant of both true JSONL (one object per line) and pretty-printed
    concatenated JSON objects: it decodes objects one after another, skipping any
    whitespace (including newlines) between them.
    """
    text = path.read_text(encoding="utf-8")
    decoder = json.JSONDecoder()
    cases: list[dict[str, Any]] = []
    idx = 0
    length = len(text)
    while idx < length:
        # Skip whitespace between objects.
        while idx < length and text[idx].isspace():
            idx += 1
        if idx >= length:
            break
        obj, end = decoder.raw_decode(text, idx)
        cases.append(obj)
        idx = end
    return cases


def split_case(case: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any] | None]:
    """Split a fixture row into ``(input, expected_output)``.

    ``input`` holds exactly the keyword arguments the target accepts; ground-truth
    fields (:data:`EXPECTED_FIELDS`) are moved into ``expected_output`` (``None``
    when the row has none).
    """
    input_data = {k: v for k, v in case.items() if k not in EXPECTED_FIELDS}
    expected = {k: case[k] for k in EXPECTED_FIELDS if k in case}
    return input_data, (expected or None)


def item_id(operation: str, input_data: dict[str, Any]) -> str:
    """Deterministic, globally-unique dataset item id derived from content.

    Includes the operation so ids stay unique across the per-operation datasets
    (Langfuse requires dataset item ids to be globally unique).
    """
    canonical = json.dumps(input_data, sort_keys=True, ensure_ascii=False, default=str)
    digest = hashlib.sha256(f"{operation}\0{canonical}".encode("utf-8")).hexdigest()[:32]
    return f"{operation}-{digest}"


def sync_dataset(client: Any, operation: str, cases: list[dict[str, Any]]) -> Any:
    """Upsert ``cases`` into the Langfuse dataset for ``operation`` and return it.

    Creating the dataset is idempotent (``create_dataset`` upserts by name), and
    each item is written with a content-stable id so repeated runs update rather
    than duplicate. Returns the fetched ``DatasetClient`` (with ``.items``).
    """
    name = dataset_name(operation)
    client.create_dataset(name=name, description=f"LLM eval fixtures for '{operation}' (ADR-0012)")
    for case in cases:
        input_data, expected = split_case(case)
        client.create_dataset_item(
            dataset_name=name,
            input=input_data,
            expected_output=expected,
            id=item_id(operation, input_data),
            metadata={"operation": operation},
        )
    return client.get_dataset(name)

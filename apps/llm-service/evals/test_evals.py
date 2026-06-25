"""Tests for the Langfuse-backed eval pipeline (ADR-0012).

These cover the deterministic, I/O-free pieces — fixture parsing, item mapping,
stable ids, extraction-accuracy scoring, aggregation, and the quality gate — so
the suite is verifiable without a Langfuse instance or live LLM calls.
"""

from __future__ import annotations

import json
import types

from evals import datasets, run_evals
from evals.evaluators import (
    ExtractAccuracyEvaluator,
    _response_text,
    _score_extract_accuracy,
    _score_meta,
)


# --- fixture loading -------------------------------------------------------

def test_load_cases_jsonl(tmp_path):
    p = tmp_path / "cases.jsonl"
    p.write_text('{"a": 1}\n{"a": 2}\n', encoding="utf-8")
    assert datasets.load_cases(p) == [{"a": 1}, {"a": 2}]


def test_load_cases_pretty_printed_concatenated(tmp_path):
    """Some fixtures are pretty-printed multi-line objects, not true JSONL."""
    p = tmp_path / "cases.jsonl"
    p.write_text('{\n  "a": 1\n}\n{\n  "a": 2\n}\n', encoding="utf-8")
    assert datasets.load_cases(p) == [{"a": 1}, {"a": 2}]


def test_load_cases_trailing_whitespace(tmp_path):
    p = tmp_path / "cases.jsonl"
    p.write_text('{"a": 1}\n\n   \n', encoding="utf-8")
    assert datasets.load_cases(p) == [{"a": 1}]


# --- case splitting --------------------------------------------------------

def test_split_case_moves_ground_truth_to_expected():
    case = {
        "cv_text": "John Doe ...",
        "query": "ctx",
        "expected_name": "John Doe",
        "expected_work_count": 2,
        "expected_edu_count": 1,
    }
    input_data, expected = datasets.split_case(case)
    assert input_data == {"cv_text": "John Doe ...", "query": "ctx"}
    assert expected == {
        "expected_name": "John Doe",
        "expected_work_count": 2,
        "expected_edu_count": 1,
    }


def test_split_case_without_expectations():
    case = {"profile": {}, "message": "hi", "query": "ctx"}
    input_data, expected = datasets.split_case(case)
    assert input_data == case
    assert expected is None


# --- stable item ids -------------------------------------------------------

def test_item_id_is_deterministic_and_namespaced():
    a = datasets.item_id("generate", {"x": 1, "y": 2})
    b = datasets.item_id("generate", {"y": 2, "x": 1})  # key order independent
    assert a == b
    assert a.startswith("generate-")


def test_item_id_differs_by_operation_and_content():
    base = {"x": 1}
    assert datasets.item_id("generate", base) != datasets.item_id("extract", base)
    assert datasets.item_id("generate", {"x": 1}) != datasets.item_id("generate", {"x": 2})


def test_dataset_name():
    assert datasets.dataset_name("security") == "eval-security"


# --- extraction-accuracy scoring (deterministic) ---------------------------

def _values(scores: dict) -> dict:
    return {metric: s["value"] for metric, s in scores.items()}


def _extract_doc(full_name: str, work: int, edu: int) -> dict:
    """A ProfileDocument with `work`/`edu` timeline items (ADR-0013 extract shape)."""
    sections = []
    if work:
        sections.append({"template": "timeline", "heading": "Work Experience",
                         "items": [{} for _ in range(work)]})
    if edu:
        sections.append({"template": "timeline", "heading": "Education",
                         "items": [{} for _ in range(edu)]})
    return {"header": {"fullName": full_name}, "sections": sections}


def test_extract_accuracy_all_match():
    profile = _extract_doc("Jane Q Public", work=2, edu=1)
    scores = _score_extract_accuracy(
        json.dumps(profile),
        {"expected_name": "Jane Public", "expected_work_count": 2, "expected_edu_count": 1},
    )
    assert _values(scores) == {"name_match": 1, "work_count_match": 1, "edu_count_match": 1}


def test_extract_accuracy_count_mismatch():
    profile = _extract_doc("Jane Public", work=1, edu=0)
    scores = _score_extract_accuracy(
        json.dumps(profile),
        {"expected_name": "Jane Public", "expected_work_count": 2, "expected_edu_count": 1},
    )
    assert scores["name_match"]["value"] == 1
    assert scores["work_count_match"]["value"] == 0
    assert scores["edu_count_match"]["value"] == 0
    # the comment records the expected-vs-extracted detail for the scores table
    assert "expected 2 work experiences, extracted 1" in scores["work_count_match"]["comment"]


def test_extract_accuracy_missing_expectations_skip_to_one():
    profile = _extract_doc("Anyone", work=0, edu=0)
    scores = _score_extract_accuracy(json.dumps(profile), None)
    assert _values(scores) == {"name_match": 1, "work_count_match": 1, "edu_count_match": 1}
    assert "skipped" in scores["name_match"]["comment"]


def test_extract_accuracy_invalid_json_all_zero():
    scores = _score_extract_accuracy("not json", {"expected_name": "X"})
    assert _values(scores) == {"name_match": 0, "work_count_match": 0, "edu_count_match": 0}
    assert scores["name_match"]["comment"] == "response was not valid JSON"


def test_extract_accuracy_evaluator_returns_named_evaluations_with_comments_and_metadata():
    profile = _extract_doc("Jane Public", work=1, edu=1)
    evals_out = ExtractAccuracyEvaluator()(
        output={"response": json.dumps(profile)},
        expected_output={"expected_name": "Jane Public", "expected_work_count": 1, "expected_edu_count": 1},
        metadata={"operation": "extract"},
    )
    by_name = {e.name: e.value for e in evals_out}
    assert by_name == {
        "extract_accuracy.name_match": 1,
        "extract_accuracy.work_count_match": 1,
        "extract_accuracy.edu_count_match": 1,
    }
    # scores carry a rationale comment and the operation in metadata
    assert all(e.comment for e in evals_out)
    assert all(e.metadata == {"operation": "extract"} for e in evals_out)


# --- response extraction ---------------------------------------------------

def test_response_text_from_dict_and_raw():
    assert _response_text({"response": "hello"}) == "hello"
    assert _response_text("hello") == "hello"
    assert _response_text(None) == ""


# --- score metadata --------------------------------------------------------

def test_score_meta_includes_operation_and_extras():
    assert _score_meta({"operation": "extract"}) == {"operation": "extract"}
    assert _score_meta({"operation": "generate"}, model="claude-x") == {
        "operation": "generate",
        "model": "claude-x",
    }


def test_score_meta_drops_none_and_empties_to_none():
    assert _score_meta(None) is None
    assert _score_meta({}, model=None) is None


# --- aggregation + quality gate -------------------------------------------

def _item(evaluations, output=None):
    evs = [types.SimpleNamespace(name=n, value=v) for n, v in evaluations]
    return types.SimpleNamespace(evaluations=evs, output=output, item=None)


def test_aggregate_means_by_name():
    results = [
        _item([("quality.coherence", 4), ("quality.relevance", 3)]),
        _item([("quality.coherence", 2), ("quality.relevance", 5)]),
    ]
    metrics = run_evals.aggregate(results)
    assert metrics["quality.coherence"] == 3.0
    assert metrics["quality.relevance"] == 4.0


def test_aggregate_counts_booleans_and_skips_non_numeric():
    results = [
        _item([("on_task.on_task", True), ("note", "skip-me")]),
        _item([("on_task.on_task", False)]),
    ]
    metrics = run_evals.aggregate(results)
    assert metrics["on_task.on_task"] == 0.5
    assert "note" not in metrics


def test_evaluate_thresholds_flags_breaches_only():
    metrics = {"quality.coherence": 3.0, "quality.professionalism": 4.5}
    thresholds = {"quality.coherence": 3.5, "quality.professionalism": 4.0}
    failures = run_evals.evaluate_thresholds(metrics, thresholds)
    assert len(failures) == 1
    assert "quality.coherence" in failures[0]


def test_evaluate_thresholds_ignores_missing_metrics():
    assert run_evals.evaluate_thresholds({}, {"quality.coherence": 3.5}) == []


def test_item_input_handles_dataset_object_and_dict():
    assert run_evals._item_input({"input": {"a": 1}}) == {"a": 1}
    assert run_evals._item_input(types.SimpleNamespace(input={"b": 2})) == {"b": 2}
    assert run_evals._item_input(types.SimpleNamespace(input=None)) == {}


# --- config: operations and thresholds stay in sync ------------------------

def test_every_operation_has_a_fixtures_file():
    for op, (_, fixture_path, _) in run_evals._OPERATIONS.items():
        assert fixture_path.exists(), f"missing fixtures for {op}: {fixture_path}"


def test_thresholds_reference_known_operations():
    assert set(run_evals._THRESHOLDS).issubset(set(run_evals._OPERATIONS))


def test_env_for_is_valid_langfuse_environment():
    import re

    # Langfuse: lowercase alphanumeric + - / _, must not start with "langfuse".
    pattern = re.compile(r"^[a-z0-9_-]+$")
    for op in run_evals._OPERATIONS:
        env = run_evals._env_for(op)
        assert env == f"eval-{op}"
        assert pattern.match(env), f"invalid environment name: {env}"
        assert not env.startswith("langfuse")

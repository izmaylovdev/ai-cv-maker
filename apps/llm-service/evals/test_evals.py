"""Tests for the Langfuse-backed eval pipeline (ADR-0012).

These cover the deterministic, I/O-free pieces — fixture parsing, item mapping,
stable ids, extraction-accuracy scoring, aggregation, and the quality gate — so
the suite is verifiable without a Langfuse instance or live LLM calls.
"""

from __future__ import annotations

import json
import types

import pytest

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


# --- application-message style scoring (US-EXT-5, deterministic) ------------
#
# ApplicationMessageStyleEvaluator scores generated application text on the
# absence of letter formalities: `style.no_salutation`, `style.no_signoff`,
# `style.no_placeholders` (binary 0/1, same Evaluation conventions as
# ExtractAccuracyEvaluator). Cases whose dataset-item metadata marks them as
# intentionally requesting letter format (`style_exempt`) are skipped (score 1).
#
# The import is deliberately inside a helper (not module-level) so the red
# state of these tests does not fail collection of the pre-existing tests
# above — each new test fails individually with ImportError until the
# evaluator exists.

_CLEAN_APPLICATION_MESSAGE = (
    "I have spent eight years building distributed systems in Python and Go, "
    "most recently leading the migration of a monolith to microservices at Acme Corp. "
    "That experience maps directly onto the platform work described in this role."
)

_STYLE_METADATA = {"operation": "cover_letter_with_prefs"}


def _style_evaluator():
    from evals.evaluators import ApplicationMessageStyleEvaluator

    return ApplicationMessageStyleEvaluator()


def _style_values(text: str, metadata: dict | None = None) -> dict:
    evals_out = _style_evaluator()(
        output={"response": text}, metadata=metadata or dict(_STYLE_METADATA)
    )
    return {e.name: e.value for e in evals_out}


def test_style_evaluator_clean_message_scores_one_on_all_metrics():
    assert _style_values(_CLEAN_APPLICATION_MESSAGE) == {
        "style.no_salutation": 1,
        "style.no_signoff": 1,
        "style.no_placeholders": 1,
    }


def test_style_evaluator_flags_salutation_line():
    values = _style_values("Dear Hiring Manager,\n\n" + _CLEAN_APPLICATION_MESSAGE)
    assert values["style.no_salutation"] == 0
    assert values["style.no_signoff"] == 1
    assert values["style.no_placeholders"] == 1


def test_style_evaluator_flags_signoff_and_signature_block():
    values = _style_values(_CLEAN_APPLICATION_MESSAGE + "\n\nSincerely,\nJane Doe")
    assert values["style.no_signoff"] == 0
    assert values["style.no_salutation"] == 1
    assert values["style.no_placeholders"] == 1


def test_style_evaluator_flags_bracketed_placeholders():
    values = _style_values(
        "I would bring my Python experience to [Company Name] and help "
        "[Hiring Manager] scale the platform."
    )
    assert values["style.no_placeholders"] == 0
    assert values["style.no_salutation"] == 1
    assert values["style.no_signoff"] == 1


def test_style_evaluator_exempts_case_marked_as_letter_format():
    """The preferences-override fixture case intentionally requests a formal
    letter; its metadata marker makes the style evaluator skip (score 1)."""
    letter = (
        "Dear Hiring Manager,\n\n"
        + _CLEAN_APPLICATION_MESSAGE
        + "\n\nSincerely,\nJane Doe"
    )
    values = _style_values(
        letter, metadata={"operation": "cover_letter_with_prefs", "style_exempt": True}
    )
    assert values == {
        "style.no_salutation": 1,
        "style.no_signoff": 1,
        "style.no_placeholders": 1,
    }


def test_style_evaluator_evaluations_carry_comment_and_metadata():
    evals_out = _style_evaluator()(
        output={"response": _CLEAN_APPLICATION_MESSAGE}, metadata=dict(_STYLE_METADATA)
    )
    assert all(e.comment for e in evals_out)
    assert all(
        e.metadata == {"operation": "cover_letter_with_prefs"} for e in evals_out
    )


# --- US-EXT-5 wiring: op evaluators, thresholds, exempt fixture case ---------

def test_cover_letter_with_prefs_op_includes_style_evaluator():
    from evals.evaluators import ApplicationMessageStyleEvaluator

    _, _, evaluators = run_evals._OPERATIONS["cover_letter_with_prefs"]
    assert any(isinstance(e, ApplicationMessageStyleEvaluator) for e in evaluators)


def test_cover_letter_with_prefs_thresholds_gate_style_metrics():
    thresholds = run_evals._THRESHOLDS["cover_letter_with_prefs"]
    assert thresholds.get("style.no_salutation") == 1.0
    assert thresholds.get("style.no_signoff") == 1.0
    assert thresholds.get("style.no_placeholders") == 1.0


def test_cover_letter_with_prefs_fixtures_include_style_exempt_letter_case():
    """One fixture case explicitly requests a formal letter via
    global_preferences and is marked exempt so the style gate skips it."""
    cases = datasets.load_cases(
        run_evals._FIXTURES_DIR / "cover_letter_with_prefs_cases.jsonl"
    )

    def _is_exempt(case: dict) -> bool:
        return bool(
            case.get("style_exempt") or (case.get("metadata") or {}).get("style_exempt")
        )

    exempt = [c for c in cases if _is_exempt(c)]
    assert exempt, "expected a fixture case marked style_exempt"
    prefs = " ".join(str(c.get("global_preferences", "")) for c in exempt).lower()
    assert "letter" in prefs
    assert "salutation" in prefs or "dear" in prefs or "sign-off" in prefs


# --- LLM judge on the installed Anthropic SDK -------------------------------


@pytest.mark.asyncio
async def test_quality_judge_sends_no_sampling_params_through_real_sdk():
    """The LLM-as-judge calls Claude directly on the installed SDK (2.x, API
    version 2026-10-21), which rejects temperature/top_p/top_k on every model.
    The judge must still score — and send no sampling parameter."""
    from app.anthropic_test_support import MODEL, Recorder, assert_wire_contract, real_client
    from evals.evaluators import CVQualityEvaluator

    recorder = Recorder(json.dumps({
        "coherence": 4, "professionalism": 5, "relevance": 3,
        "reason": "Clear and polished, loosely tailored.",
    }))
    judge = CVQualityEvaluator()
    judge._client = real_client(recorder)
    judge._model = MODEL

    evals_out = await judge(
        input={"query": "Senior Backend Engineer"},
        output={"response": "Seasoned backend engineer."},
        metadata={"operation": "generate"},
    )

    assert {e.name: e.value for e in evals_out} == {
        "quality.coherence": 4,
        "quality.professionalism": 5,
        "quality.relevance": 3,
    }, "judge failed to score — the SDK call likely raised (see captured log)"
    assert_wire_contract(recorder, min_requests=1)

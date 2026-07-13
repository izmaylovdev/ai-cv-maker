"""US-PROF-8 / F-PROF-8.1–8.2 — extract_profile returns an LLM-suggested
profile name in the same call as the document extraction.

The model now answers with a wrapper object ``{"profileName": str,
"document": ProfileDocument}``; a bare ProfileDocument (legacy output) must
still parse, with the name falling back code-side to header.title, then
header.fullName, else "".

The LLM call itself is stubbed (LangChain path) — these tests exercise only
the parsing / fallback logic.
"""
from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

import pytest
from langchain_core.messages import AIMessage

from app.schemas import ExtractResponse, ProfileDocument


def _doc_json(full_name: str = "", title: str = "") -> dict:
    """A minimal valid ADR-0014 ProfileDocument as a plain dict."""
    return {
        "header": {
            "fullName": full_name,
            "title": title,
            "email": "",
            "phone": "",
            "location": "",
        },
        "body": {
            "type": "root",
            "id": "r1",
            "attrs": {},
            "children": [
                {"type": "title", "id": "t1", "attrs": {"text": "Summary"}, "children": []},
                {
                    "type": "paragraph",
                    "id": "p1",
                    "attrs": {},
                    "children": [
                        {"type": "text", "id": "x1", "attrs": {"text": "Experienced engineer."}, "children": []},
                    ],
                },
            ],
        },
    }


async def _run_extract(model_output: str) -> ExtractResponse:
    """Run extract_profile with the LLM stubbed to return ``model_output``."""
    from app.chains.cv_chain import extract_profile

    with (
        patch("app.chains.cv_chain.app_settings.llm_provider", return_value="openai"),
        patch("app.chains.cv_chain._build_llm", return_value=object()),
        patch("app.observability.lc_invoke", new=AsyncMock(return_value=AIMessage(content=model_output))),
    ):
        result, _usage = await extract_profile("John Doe\nSoftware Engineer\nPython, Go")
    return result


# ---------------------------------------------------------------------------
# Schema — ExtractResponse carries profile_name, defaulting to ""
# ---------------------------------------------------------------------------

def test_extract_response_schema_defaults_profile_name_to_empty():
    response = ExtractResponse(document=ProfileDocument.model_validate(_doc_json()))
    assert response.profile_name == ""


# ---------------------------------------------------------------------------
# Wrapper JSON — profileName + document parsed from one model answer
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_extract_parses_profile_name_from_wrapper_json():
    output = json.dumps({
        "profileName": "Senior Backend Engineer",
        "document": _doc_json("Jane Doe", "Senior Backend Engineer"),
    })

    result = await _run_extract(output)

    assert result.profile_name == "Senior Backend Engineer"
    assert result.document.header.fullName == "Jane Doe"


@pytest.mark.asyncio
async def test_extract_blank_wrapper_name_falls_back_to_header_title():
    # F-PROF-8.2 code-side fallback when the model left profileName blank.
    output = json.dumps({
        "profileName": "",
        "document": _doc_json("Jane Doe", "Backend Developer"),
    })

    result = await _run_extract(output)

    assert result.profile_name == "Backend Developer"


@pytest.mark.asyncio
async def test_extract_name_empty_when_nothing_derivable():
    # No model name, no title, no full name → suggested name is empty.
    output = json.dumps({"profileName": "", "document": _doc_json()})

    result = await _run_extract(output)

    assert result.profile_name == ""


# ---------------------------------------------------------------------------
# Prompt contract — the extract prompt asks for the wrapper with profileName
# ---------------------------------------------------------------------------

def test_extract_system_prompt_requests_profile_name_wrapper():
    # F-PROF-8.1 — one JSON object {"profileName", "document"}, same LLM call.
    from app.chains.cv_chain import _EXTRACT_SYSTEM_PROMPT

    assert "profileName" in _EXTRACT_SYSTEM_PROMPT


# ---------------------------------------------------------------------------
# Legacy output — a bare ProfileDocument still parses (no wrapper)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_extract_legacy_bare_document_still_parses_with_title_fallback():
    output = json.dumps(_doc_json("Jane Doe", "Data Scientist"))

    result = await _run_extract(output)

    assert result.document.header.fullName == "Jane Doe"
    assert result.profile_name == "Data Scientist"


@pytest.mark.asyncio
async def test_extract_legacy_bare_document_falls_back_to_full_name_when_no_title():
    output = json.dumps(_doc_json("Ada Lovelace", ""))

    result = await _run_extract(output)

    assert result.profile_name == "Ada Lovelace"

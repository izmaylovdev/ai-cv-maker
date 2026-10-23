"""Per-chain wire tests for the Anthropic path on the installed SDK.

Each RPC's chain runs end to end with ``LLM_PROVIDER=anthropic`` and
``LLM_TEMPERATURE=0.4``, talking to a real ``AsyncAnthropic`` client whose HTTP
transport is mocked (see ``app/anthropic_test_support.py``). The SDK's current
API version (``2026-10-21``) rejects ``temperature`` / ``top_p`` / ``top_k`` on
every model, so every request each chain sends must:

- carry ``anthropic-version: 2026-10-21``;
- carry no sampling parameter (LLM_TEMPERATURE only applies to LangChain
  providers);

while the chain still returns the parsed result the user sees.
"""

from __future__ import annotations

import json

import pytest

from app import observability
from app.anthropic_test_support import (
    MODEL,
    Recorder,
    assert_wire_contract,
    real_client,
    text_turn,
    tool_use_turn,
)
from app.schemas import ProfileHeader

from .conftest import (
    entry_node,
    free_form_section,
    list_node,
    list_section,
    paragraph_node,
    profile_document,
    timeline_section,
)


def _doc_json(full_name: str, title: str, summary: str) -> dict:
    """A minimal valid ADR-0014 ProfileDocument (flat body) as a plain dict."""
    return {
        "header": {"fullName": full_name, "title": title, "email": "", "phone": "", "location": ""},
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
                        {"type": "text", "id": "x1", "attrs": {"text": summary}, "children": []}
                    ],
                },
            ],
        },
    }


@pytest.fixture(autouse=True)
def _anthropic_env(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "anthropic")
    monkeypatch.setenv("LLM_MODEL", MODEL)
    monkeypatch.setenv("LLM_TEMPERATURE", "0.4")
    for var in ("LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY", "LANGFUSE_HOST"):
        monkeypatch.delenv(var, raising=False)
    observability.reset()
    yield
    observability.reset()


def _use_recorder(monkeypatch, module, recorder: Recorder) -> None:
    """Route the chain module's Anthropic client factory to the real-SDK recorder."""
    monkeypatch.setattr(
        module, "_build_anthropic_messages_client", lambda _provider: real_client(recorder)
    )


@pytest.fixture()
def backend_profile():
    return profile_document(
        id="prof-backend",
        header=ProfileHeader(fullName="Jane Doe", title="Senior Backend Engineer", location="Berlin"),
        sections=[
            free_form_section("Summary", "8 years building distributed Python and Go services."),
            timeline_section(
                "Work Experience",
                [entry_node("Backend Engineer · Acme Corp", "2018 – 2023",
                            "Led migration of monolith to microservices in Python.")],
            ),
            list_section("Skills", ["Python", "Go", "gRPC"]),
        ],
    )


@pytest.fixture()
def frontend_profile():
    return profile_document(
        id="prof-frontend",
        header=ProfileHeader(fullName="Jane Doe", title="Frontend Developer", location="Berlin"),
        sections=[
            free_form_section("Summary", "5 years building React and Angular SPAs."),
            list_section("Skills", ["React", "TypeScript", "Angular"]),
        ],
    )


# ---------------------------------------------------------------------------
# Generate — "Generating a CV for a job profile produces a rendered CV."
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_generate_cv_sends_no_sampling_params(monkeypatch, backend_profile):
    from app.chains import cv_chain

    polished = _doc_json("Jane Doe", "Senior Backend Engineer", "Seasoned backend engineer.")
    recorder = Recorder(json.dumps(polished))
    _use_recorder(monkeypatch, cv_chain, recorder)

    result, usage = await cv_chain.generate_cv(backend_profile, message="Staff Engineer at Acme")

    assert result.document.header.fullName == "Jane Doe"
    assert result.document.body.children[1].children[0].attrs["text"] == "Seasoned backend engineer."
    assert usage.prompt_tokens == 12
    assert recorder.bodies[0]["model"] == MODEL
    assert_wire_contract(recorder, min_requests=1)


# ---------------------------------------------------------------------------
# Extract — "Importing a CV creates a job profile with its fields filled."
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_extract_profile_sends_no_sampling_params(monkeypatch):
    from app.chains import cv_chain

    extracted = {
        "profileName": "Senior Backend Engineer",
        "document": _doc_json("Jane Doe", "Senior Backend Engineer", "Backend engineer, 8 years."),
    }
    recorder = Recorder(json.dumps(extracted))
    _use_recorder(monkeypatch, cv_chain, recorder)

    result, _usage = await cv_chain.extract_profile(
        "Jane Doe\nSenior Backend Engineer\nAcme Corp 2018 – 2023: Python, Go, gRPC."
    )

    assert result.profile_name == "Senior Backend Engineer"
    assert result.document.header.fullName == "Jane Doe"
    assert result.document.header.title == "Senior Backend Engineer"
    assert_wire_contract(recorder, min_requests=1)


# ---------------------------------------------------------------------------
# In-editor chat (streamed tool loop) — "a message in the in-editor assistant
# gets a real reply, and an edit instruction changes the document."
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_chat_tool_loop_edit_sends_no_sampling_params_on_any_turn(monkeypatch):
    from app.chains import chat_chain
    from app.chains.chat_chain import OtherProfile

    open_profile = profile_document(
        header=ProfileHeader(fullName="Jane Doe", title="Software Engineer"),
        sections=[list_node(["Python"])],
    )
    other = OtherProfile(
        id="other-1",
        name="Backend Engineer",
        document=profile_document(
            header=ProfileHeader(fullName="Jane Doe", title="Backend Engineer"),
            sections=[paragraph_node("Rust and Go backend work."), list_node(["Rust", "Go"])],
        ),
    )
    envelope = {
        "reply": "I added Rust and Go to your skills.",
        "proposal": {
            "type": "edit",
            "description": "Add Rust and Go",
            "patch_json": json.dumps({"ops": [{"op": "insert", "parentId": "x", "index": 0,
                                               "node": {"type": "chip", "attrs": {"text": "Rust"}}}]}),
        },
    }
    recorder = Recorder([
        tool_use_turn("list_profiles", {}),
        text_turn(json.dumps(envelope)),
    ])
    _use_recorder(monkeypatch, chat_chain, recorder)

    response, usage = await chat_chain.chat_reply(
        open_profile, "Add the skills from my backend profile", history=[], other_profiles=[other]
    )

    assert response.reply == "I added Rust and Go to your skills."
    assert response.proposal is not None and response.proposal.type == "edit"
    assert json.loads(response.proposal.patch_json)["ops"], "edit proposal must carry ops"
    # Two streamed turns: the tool call, then the final answer after the tool result.
    assert len(recorder.bodies) == 2
    assert all(body.get("stream") is True for body in recorder.bodies)
    assert recorder.bodies[0]["tools"], "tools are offered when other profiles exist"
    tool_result = recorder.bodies[1]["messages"][-1]["content"][0]
    assert tool_result["type"] == "tool_result"
    assert usage.prompt_tokens == 24
    assert_wire_contract(recorder, min_requests=2)


# ---------------------------------------------------------------------------
# Global assistant — "A message in the global assistant gets a real reply."
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_user_chat_with_history_sends_no_sampling_params(monkeypatch):
    from app.chains import user_chat_chain
    from app.chains.user_chat_chain import ChatMessage, ProfileSummary

    recorder = Recorder("Your backend profile fits that role best.")
    _use_recorder(monkeypatch, user_chat_chain, recorder)

    response, _usage = await user_chat_chain.user_chat_reply(
        profiles=[ProfileSummary(name="Backend", title="Backend Engineer",
                                 overview="Python services", skills=["Python"])],
        message="Which profile fits a backend role?",
        history=[ChatMessage(role="user", content="Hi"),
                 ChatMessage(role="assistant", content="Hello! How can I help?")],
    )

    assert response.reply == "Your backend profile fits that role best."
    assert response.preferences_update is None
    assert [m["role"] for m in recorder.bodies[0]["messages"]] == ["user", "assistant", "user"]
    assert_wire_contract(recorder, min_requests=1)


# ---------------------------------------------------------------------------
# Extension endpoints — "cover letter, best-profile pick, job chat answer."
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_job_chat_sends_no_sampling_params(monkeypatch):
    from app.chains import job_chat_chain
    from app.chains.user_chat_chain import ProfileSummary

    answer = {
        "reply": "Here's a draft cover letter for this role:",
        "proposal": {"type": "fill", "description": "Cover letter draft",
                     "text": "I have eight years of backend experience in Python and Go."},
    }
    recorder = Recorder(json.dumps(answer))
    _use_recorder(monkeypatch, job_chat_chain, recorder)

    response, _usage = await job_chat_chain.job_chat_reply(
        profiles=[ProfileSummary(name="Backend", title="Backend Engineer",
                                 overview="Python services", skills=["Python", "Go"])],
        job_title="Senior Backend Engineer",
        job_description="Build distributed Python services.",
        field_context="cover letter",
        message="Write me a cover letter",
        history=[],
    )

    assert response.reply == "Here's a draft cover letter for this role:"
    assert response.proposal is not None
    assert response.proposal.text == "I have eight years of backend experience in Python and Go."
    assert_wire_contract(recorder, min_requests=1)


@pytest.mark.asyncio
async def test_cover_letter_sends_no_sampling_params(monkeypatch, backend_profile, frontend_profile):
    from app.chains import cover_letter_chain
    from app.chains.cover_letter_chain import CoverLetterRequest

    recorder = Recorder(
        "PROFILE_INDEX: 1\nCOVER_LETTER: I have built React and Angular SPAs for five years."
    )
    _use_recorder(monkeypatch, cover_letter_chain, recorder)

    result, _usage = await cover_letter_chain.generate_cover_letter(CoverLetterRequest(
        profiles=[backend_profile, frontend_profile],
        profile_ids=["prof-backend", "prof-frontend"],
        job_title="Frontend Developer",
        job_description="Build React dashboards.",
        field_context="Why do you want this job?",
    ))

    assert result.selected_profile_id == "prof-frontend"
    assert result.text == "I have built React and Angular SPAs for five years."
    assert_wire_contract(recorder, min_requests=1)


@pytest.mark.asyncio
async def test_select_best_profile_sends_no_sampling_params(
    monkeypatch, backend_profile, frontend_profile
):
    from app.chains import profile_selector_chain

    recorder = Recorder(json.dumps({"selected_profile_id": "prof-backend"}))
    _use_recorder(monkeypatch, profile_selector_chain, recorder)

    result = await profile_selector_chain.select_best_profile(
        [backend_profile, frontend_profile], "Senior Python backend engineer, gRPC, Go."
    )

    assert result.selected_profile_id == "prof-backend"
    assert_wire_contract(recorder, min_requests=1)


# ---------------------------------------------------------------------------
# LangChain providers keep LLM_TEMPERATURE — "With LLM_PROVIDER=google, the
# global assistant still replies (the LangChain path keeps using LLM_TEMPERATURE)."
# ---------------------------------------------------------------------------

def test_langchain_google_model_keeps_llm_temperature(monkeypatch):
    """Regression guard for the change: dropping temperature from the Anthropic
    path must not drop it from LangChain providers built by _build_llm()."""
    from app.chains import cv_chain

    monkeypatch.setenv("LLM_PROVIDER", "google")
    monkeypatch.setenv("LLM_MODEL", "gemini-2.5-flash")
    monkeypatch.setenv("LLM_TEMPERATURE", "0.7")
    monkeypatch.setenv("GOOGLE_API_KEY", "test-google-key")

    llm = cv_chain._build_llm()

    assert llm.temperature == 0.7

"""US-AI-13 — the in-editor AI Editor can read the user's other saved profiles
on demand via tools (list_profiles / get_profile), while still editing only the
open document."""
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.schemas import ProfileDocument, ProfileHeader

from .conftest import list_node, paragraph_node, profile_document


def _other(id: str, name: str, title: str, overview: str) -> "OtherProfile":  # noqa: F821
    from app.chains.chat_chain import OtherProfile

    doc = profile_document(
        header=ProfileHeader(fullName="Jane Doe", title=title),
        sections=[paragraph_node(overview), list_node(["Rust", "Go"])],
    )
    return OtherProfile(id=id, name=name, document=doc)


@pytest.fixture()
def open_profile() -> ProfileDocument:
    return profile_document(
        header=ProfileHeader(fullName="Jane Doe", title="Software Engineer"),
        sections=[list_node(["Python"])],
    )


# ---------------------------------------------------------------------------
# Tool resolution (in-process, no DB) — F-AI-13.1, F-AI-13.5
# ---------------------------------------------------------------------------

def test_list_profiles_tool_returns_summaries():
    from app.chains.chat_chain import _resolve_tool

    others = [
        _other("id-1", "Backend Engineer", "Backend Engineer", "Rust and Go backend work."),
        _other("id-2", "Data Scientist", "Data Scientist", "ML pipelines and analytics."),
    ]

    result = json.loads(_resolve_tool("list_profiles", {}, others))

    assert [p["id"] for p in result] == ["id-1", "id-2"]
    assert result[0]["name"] == "Backend Engineer"
    assert result[0]["title"] == "Backend Engineer"
    assert result[0]["overview"] == "Rust and Go backend work."


def test_get_profile_tool_returns_full_document():
    from app.chains.chat_chain import _resolve_tool

    others = [_other("id-1", "Backend Engineer", "Backend Engineer", "Rust and Go backend work.")]

    result = json.loads(_resolve_tool("get_profile", {"profile_id": "id-1"}, others))

    # Full document — header + body tree, not just a summary.
    assert result["header"]["title"] == "Backend Engineer"
    assert result["body"]["type"] == "root"


def test_get_profile_unknown_id_returns_error():
    from app.chains.chat_chain import _resolve_tool

    others = [_other("id-1", "Backend Engineer", "Backend Engineer", "overview")]

    result = json.loads(_resolve_tool("get_profile", {"profile_id": "nope"}, others))

    assert "error" in result


def test_unknown_tool_returns_error():
    from app.chains.chat_chain import _resolve_tool

    result = json.loads(_resolve_tool("frobnicate", {}, []))
    assert "error" in result


# ---------------------------------------------------------------------------
# chat_reply forwards other_profiles to the LLM layer — F-AI-13.1
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_chat_reply_forwards_other_profiles(open_profile):
    from app.chains.chat_chain import chat_reply

    others = [_other("id-1", "Backend Engineer", "Backend Engineer", "overview")]
    captured: dict = {}

    async def capture(profile, message, history, other_profiles):
        captured["others"] = other_profiles
        mock = MagicMock()
        mock.reply = "ok"
        mock.proposal = None
        return mock

    with patch("app.chains.chat_chain._chat_with_llm", new=capture):
        await chat_reply(open_profile, "add Rust from my Backend CV", [], others)

    assert [p.id for p in captured["others"]] == ["id-1"]


@pytest.mark.asyncio
async def test_chat_reply_defaults_other_profiles_to_empty(open_profile):
    """US-AI-9 callers that don't pass other_profiles still work (backward compat)."""
    from app.chains.chat_chain import chat_reply

    captured: dict = {}

    async def capture(profile, message, history, other_profiles):
        captured["others"] = other_profiles
        mock = MagicMock()
        mock.reply = "ok"
        mock.proposal = None
        return mock

    with patch("app.chains.chat_chain._chat_with_llm", new=capture):
        await chat_reply(open_profile, "what is my title?", [])

    assert captured["others"] == []


# ---------------------------------------------------------------------------
# Anthropic tool-use loop — F-AI-13.2, F-AI-13.6
# ---------------------------------------------------------------------------

def _text_block(text: str):
    b = MagicMock()
    b.type = "text"
    b.text = text
    return b


def _tool_use_block(tool_id: str, name: str, tool_input: dict):
    b = MagicMock()
    b.type = "tool_use"
    b.id = tool_id
    b.name = name
    b.input = tool_input
    return b


def _usage(inp: int, out: int):
    u = MagicMock()
    u.input_tokens = inp
    u.output_tokens = out
    return u


@pytest.mark.asyncio
async def test_anthropic_loop_resolves_get_profile_then_answers(open_profile):
    from app.chains import chat_chain

    others = [_other("id-1", "Backend Engineer", "Backend Engineer", "Rust and Go backend work.")]

    # Turn 1: the model asks for the Backend profile. Turn 2: it answers with an edit.
    turn1 = MagicMock()
    turn1.stop_reason = "tool_use"
    turn1.content = [_tool_use_block("tu-1", "get_profile", {"profile_id": "id-1"})]
    turn1.usage = _usage(100, 20)

    final_json = json.dumps({
        "reply": "Added Rust — pulled from your Backend Engineer profile.",
        "proposal": {
            "type": "edit",
            "description": "Add chip: Rust",
            "patch_json": json.dumps({"ops": [
                {"op": "addChild", "parentId": open_profile.body.children[0].id,
                 "node": {"type": "listItem", "id": "", "children": []}}
            ]}),
        },
    })
    turn2 = MagicMock()
    turn2.stop_reason = "end_turn"
    turn2.content = [_text_block(final_json)]
    turn2.usage = _usage(150, 40)

    create = AsyncMock(side_effect=[turn1, turn2])

    with patch.object(chat_chain, "_build_anthropic_messages_client", return_value=MagicMock()), \
         patch.object(chat_chain, "_get_anthropic_model", return_value="claude-x"), \
         patch("app.settings.llm_provider", return_value="anthropic"), \
         patch("app.observability.anthropic_stream", new=create):
        result, usage = await chat_chain.chat_reply(
            open_profile, "add the Rust experience from my Backend CV", [], others
        )

    # Two model turns: one tool call, one final answer.
    assert create.await_count == 2
    # The second call carries the tool_result for get_profile.
    second_messages = create.await_args_list[1].kwargs["messages"]
    assert any(
        isinstance(m.get("content"), list)
        and any(isinstance(c, dict) and c.get("type") == "tool_result" for c in m["content"])
        for m in second_messages
    )
    assert "Backend Engineer" in result.reply
    assert result.proposal is not None and result.proposal.type == "edit"
    # Usage accumulates across both turns.
    assert usage.prompt_tokens == 250
    assert usage.completion_tokens == 60


@pytest.mark.asyncio
async def test_anthropic_loop_clarifying_question_after_tool_is_shown(open_profile):
    """Regression (Langfuse trace 99d91a29): the model calls list_profiles, then
    (turn 2) asks the user in plain prose which profile to use as the source. That
    prose clarifying question must be returned to the user verbatim — NOT swallowed
    as an 'unexpected format' failure — with no proposal and the doc unchanged."""
    from app.chains import chat_chain

    others = [
        _other("id-1", "Junior Machine Learning Developer", "", ""),
        _other("id-2", "Senior Software Engineer", "Senior Software Engineer", "Full-stack, 8 yrs."),
    ]

    turn1 = MagicMock()
    turn1.stop_reason = "tool_use"
    turn1.content = [_tool_use_block("tu-1", "list_profiles", {})]
    turn1.usage = _usage(100, 20)

    question = (
        "I found 2 other profiles. Which one would you like to use as the source?\n\n"
        "1. **Junior Machine Learning Developer**\n2. **Senior Software Engineer**"
    )
    turn2 = MagicMock()
    turn2.stop_reason = "end_turn"
    turn2.content = [_text_block(question)]  # plain prose, no JSON envelope
    turn2.usage = _usage(150, 40)

    create = AsyncMock(side_effect=[turn1, turn2])

    with patch.object(chat_chain, "_build_anthropic_messages_client", return_value=MagicMock()), \
         patch.object(chat_chain, "_get_anthropic_model", return_value="claude-x"), \
         patch("app.settings.llm_provider", return_value="anthropic"), \
         patch("app.observability.anthropic_stream", new=create):
        result, _ = await chat_chain.chat_reply(
            open_profile, "populate this profile based on my other one", [], others
        )

    assert create.await_count == 2  # tool call, then the prose answer
    assert result.reply == question  # verbatim, not the "unexpected format" message
    assert "unexpected format" not in result.reply
    assert result.proposal is None


@pytest.mark.asyncio
async def test_anthropic_no_tools_when_no_other_profiles(open_profile):
    """Ordinary edits with no other profiles pass no tools (US-AI-9 unchanged)."""
    from app.chains import chat_chain

    final = MagicMock()
    final.stop_reason = "end_turn"
    final.content = [_text_block(json.dumps({"reply": "Your title is Software Engineer.", "proposal": None}))]
    final.usage = _usage(80, 10)

    create = AsyncMock(return_value=final)

    with patch.object(chat_chain, "_build_anthropic_messages_client", return_value=MagicMock()), \
         patch.object(chat_chain, "_get_anthropic_model", return_value="claude-x"), \
         patch("app.settings.llm_provider", return_value="anthropic"), \
         patch("app.observability.anthropic_stream", new=create):
        result, _ = await chat_chain.chat_reply(open_profile, "what is my title?", [])

    assert create.await_count == 1
    assert "tools" not in create.await_args_list[0].kwargs
    assert result.reply == "Your title is Software Engineer."

import json
import logging
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.schemas import BlockNode, ProfileDocument, ProfileHeader

from .conftest import list_node, profile_document


def _title(text: str) -> BlockNode:
    return BlockNode(type="title", id=f"title-{text}", attrs={"text": text})


@pytest.fixture()
def simple_profile() -> ProfileDocument:
    # Flat title-anchored block tree (ADR-0014): a Skills title + a list.
    skills = list_node(["Python", "Go"])
    return profile_document(
        header=ProfileHeader(fullName="Jane Doe", title="Software Engineer", location="Berlin"),
        sections=[_title("Skills"), skills],
    )


# ---------------------------------------------------------------------------
# chat_reply — question (no proposal)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_chat_reply_question_returns_answer(simple_profile):
    from app.chains.chat_chain import chat_reply

    mock_response = MagicMock()
    mock_response.reply = "You have: Python, Go."
    mock_response.proposal = None

    with patch("app.chains.chat_chain._chat_with_llm", new=AsyncMock(return_value=mock_response)):
        result = await chat_reply(simple_profile, "What skills do I have listed?", [])

    assert result.reply == "You have: Python, Go."
    assert result.proposal is None


# ---------------------------------------------------------------------------
# chat_reply — edit instruction (with an ops-based proposal, US-AI-9 §6.4)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_chat_reply_edit_returns_convert_proposal(simple_profile):
    from app.chains.chat_chain import chat_reply

    skills_list = simple_profile.body.children[1]

    mock_proposal = MagicMock()
    mock_proposal.type = "edit"
    mock_proposal.description = "Convert Skills list to chips"
    mock_proposal.patch_json = json.dumps(
        {"ops": [{"op": "convertNode", "id": skills_list.id, "to": "chips"}]}
    )

    mock_response = MagicMock()
    mock_response.reply = "Done — I converted your Skills list into chips."
    mock_response.proposal = mock_proposal

    with patch("app.chains.chat_chain._chat_with_llm", new=AsyncMock(return_value=mock_response)):
        result = await chat_reply(simple_profile, "turn my skills list into chips", [])

    assert result.proposal is not None
    assert result.proposal.type == "edit"
    patch_data = json.loads(result.proposal.patch_json)
    assert patch_data["ops"][0]["op"] == "convertNode"
    assert patch_data["ops"][0]["to"] == "chips"
    assert patch_data["ops"][0]["id"] == skills_list.id


# ---------------------------------------------------------------------------
# _parse_response — real parser turns LLM JSON into an ops proposal
# ---------------------------------------------------------------------------

def test_parse_response_question_no_proposal():
    from app.chains.chat_chain import _parse_response

    raw = json.dumps({"reply": "Your title is Software Engineer.", "proposal": None})
    parsed = _parse_response(raw)

    assert parsed.reply == "Your title is Software Engineer."
    assert parsed.proposal is None


def test_parse_response_parses_ops_proposal():
    from app.chains.chat_chain import _parse_response

    raw = json.dumps(
        {
            "reply": "Added Python.",
            "proposal": {
                "type": "edit",
                "description": "Add chip: Python",
                "patch_json": json.dumps(
                    {"ops": [{"op": "addChild", "parentId": "chips-1", "node": {"type": "chip", "id": "", "attrs": {"text": "Python"}}}]}
                ),
            },
        }
    )
    parsed = _parse_response(raw)

    assert parsed.proposal is not None
    ops = json.loads(parsed.proposal.patch_json)["ops"]
    assert ops[0]["op"] == "addChild"
    assert ops[0]["node"]["attrs"]["text"] == "Python"


def test_parse_response_strips_markdown_fences():
    from app.chains.chat_chain import _parse_response

    raw = "```json\n" + json.dumps({"reply": "ok", "proposal": None}) + "\n```"
    parsed = _parse_response(raw)

    assert parsed.reply == "ok"
    assert parsed.proposal is None


def test_parse_response_extracts_json_after_prose_preamble():
    # Real failure mode: after using a tool, the model narrates before the fenced
    # JSON. The (valid) edit must still be extracted — not mis-reported as "too large".
    from app.chains.chat_chain import _parse_response

    envelope = {
        "reply": "Populated the open profile from your Backend Engineer profile.",
        "proposal": {
            "type": "edit",
            "description": "Populate open profile",
            "patch_json": json.dumps(
                {"ops": [{"op": "addChild", "parentId": "root",
                          "node": {"type": "title", "id": "", "attrs": {"text": "Summary"}}}]}
            ),
        },
    }
    raw = (
        "I pulled the full content from your **Backend Engineer** profile and am "
        "populating the open profile now.\n\n```json\n" + json.dumps(envelope) + "\n```"
    )
    parsed = _parse_response(raw)

    assert parsed.reply.startswith("Populated the open profile")
    assert parsed.proposal is not None and parsed.proposal.type == "edit"
    assert json.loads(parsed.proposal.patch_json)["ops"][0]["op"] == "addChild"


def test_parse_response_ignores_trailing_text_after_object():
    # Real failure mode: valid envelope followed by a trailing sign-off (the
    # "Extra data" case). raw_decode must stop at the object and ignore the rest.
    from app.chains.chat_chain import _parse_response

    envelope = {"reply": "Done.", "proposal": {
        "type": "edit", "description": "x",
        "patch_json": json.dumps({"ops": [{"op": "removeNode", "id": "n1"}]})}}
    raw = json.dumps(envelope) + "\n\nLet me know if you'd like anything else!"
    parsed = _parse_response(raw)

    assert parsed.proposal is not None
    assert json.loads(parsed.proposal.patch_json)["ops"][0]["op"] == "removeNode"


def test_parse_response_fence_with_trailing_prose_inside():
    # Prose preamble + fenced JSON + trailing text still inside the fence.
    from app.chains.chat_chain import _parse_response

    envelope = {"reply": "Renamed.", "proposal": None}
    raw = "Sure thing —\n```json\n" + json.dumps(envelope) + "\n```\nHope that helps!"
    parsed = _parse_response(raw)

    assert parsed.reply == "Renamed."
    assert parsed.proposal is None


def test_parse_response_extracts_bare_json_after_prose():
    # Prose preamble without a code fence — fall back to the outermost {...} object.
    from app.chains.chat_chain import _parse_response

    raw = 'Sure! Here you go: ' + json.dumps({"reply": "Renamed it.", "proposal": None})
    parsed = _parse_response(raw)

    assert parsed.reply == "Renamed it."
    assert parsed.proposal is None


def test_parse_response_serializes_object_patch_to_string():
    # Tolerate a model that emits patch_json as a nested object instead of a string.
    from app.chains.chat_chain import _parse_response

    raw = json.dumps(
        {
            "reply": "Done.",
            "proposal": {
                "type": "edit",
                "description": "Update title",
                "patch_json": {"ops": [{"op": "updateHeader", "fields": {"title": "Staff Engineer"}}]},
            },
        }
    )
    parsed = _parse_response(raw)

    assert isinstance(parsed.proposal.patch_json, str)
    assert json.loads(parsed.proposal.patch_json)["ops"][0]["op"] == "updateHeader"


# ---------------------------------------------------------------------------
# chat_reply — history is forwarded
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_chat_reply_passes_history(simple_profile):
    from app.chains.chat_chain import ChatMessage, chat_reply

    history = [
        ChatMessage(role="user", content="Hello"),
        ChatMessage(role="assistant", content="Hi there!"),
    ]

    mock_response = MagicMock()
    mock_response.reply = "Your title is Software Engineer."
    mock_response.proposal = None

    captured: list = []

    async def capture(profile, msg, hist, other_profiles):
        captured.append(hist)
        return mock_response

    with patch("app.chains.chat_chain._chat_with_llm", new=capture):
        await chat_reply(simple_profile, "What is my title?", history)

    assert len(captured[0]) == 2
    assert captured[0][0].role == "user"
    assert captured[0][1].role == "assistant"


# ---------------------------------------------------------------------------
# chat_reply — LLM error propagates
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_chat_reply_propagates_llm_error(simple_profile):
    from app.chains.chat_chain import chat_reply

    with patch(
        "app.chains.chat_chain._chat_with_llm",
        new=AsyncMock(side_effect=RuntimeError("LLM unavailable")),
    ):
        with pytest.raises(RuntimeError, match="LLM unavailable"):
            await chat_reply(simple_profile, "Any message", [])


# ---------------------------------------------------------------------------
# Large-edit truncation — the model's JSON envelope is cut off at the
# output-token cap (e.g. "populate this whole profile from another one").
# Instead of a raw parse error (which surfaced as an opaque INTERNAL /
# "couldn't produce a valid edit"), we return a "split the edit" nudge and
# leave the document unchanged.
# ---------------------------------------------------------------------------

def _text_block(text: str):
    b = MagicMock()
    b.type = "text"
    b.text = text
    return b


def _usage(inp: int, out: int):
    u = MagicMock()
    u.input_tokens = inp
    u.output_tokens = out
    return u


@pytest.mark.asyncio
async def test_anthropic_truncated_edit_returns_nudge(simple_profile):
    """stop_reason == 'max_tokens' → graceful nudge, no proposal (unchanged doc)."""
    from app.chains import chat_chain

    truncated = MagicMock()
    truncated.stop_reason = "max_tokens"
    # Envelope cut off mid-string — not valid JSON on its own.
    truncated.content = [_text_block('{"reply": "Sure, here is your full profil')]
    truncated.usage = _usage(200, 32000)

    create = AsyncMock(return_value=truncated)

    with patch.object(chat_chain, "_build_anthropic_messages_client", return_value=MagicMock()), \
         patch.object(chat_chain, "_get_anthropic_model", return_value="claude-x"), \
         patch("app.settings.llm_provider", return_value="anthropic"), \
         patch("app.observability.anthropic_stream", new=create):
        result, _ = await chat_chain.chat_reply(
            simple_profile, "populate this profile based on my other one", []
        )

    assert result.proposal is None
    assert "smaller edits" in result.reply


@pytest.mark.asyncio
async def test_anthropic_unparseable_json_is_distinct_from_truncation(simple_profile):
    """Finished normally (stop_reason != max_tokens) but unparseable → a DISTINCT
    'unexpected format' message, NOT the 'too large / split it' truncation nudge."""
    from app.chains import chat_chain

    broken = MagicMock()
    broken.stop_reason = "end_turn"
    broken.content = [_text_block('{"reply": "oops", "proposal": {')]  # invalid JSON
    broken.usage = _usage(120, 30)

    create = AsyncMock(return_value=broken)

    with patch.object(chat_chain, "_build_anthropic_messages_client", return_value=MagicMock()), \
         patch.object(chat_chain, "_get_anthropic_model", return_value="claude-x"), \
         patch("app.settings.llm_provider", return_value="anthropic"), \
         patch("app.observability.anthropic_stream", new=create):
        result, _ = await chat_chain.chat_reply(simple_profile, "do a big edit", [])

    assert result.proposal is None
    assert "unexpected format" in result.reply
    assert "smaller edits" not in result.reply  # must NOT be confused with truncation


@pytest.mark.asyncio
async def test_unparseable_logs_distinct_diagnosable_warning(simple_profile, caplog):
    """A recurrence must be identifiable in the logs: the unparseable path logs a
    WARNING naming the mode ('not parseable JSON'), the stop_reason, and a snippet of
    the raw output — distinct from the truncation path's log. This is the genuinely
    malformed-envelope case (the model tried to emit JSON but it's broken), NOT a
    plain-prose conversational reply (which is shown to the user, see below)."""
    from app.chains import chat_chain

    broken = MagicMock()
    broken.stop_reason = "end_turn"
    # Started the envelope but produced broken JSON (has a "{", won't decode).
    broken.content = [_text_block('{"reply": "Absolutely! I updated everything", "proposal": {')]
    broken.usage = _usage(50, 20)
    create = AsyncMock(return_value=broken)

    with patch.object(chat_chain, "_build_anthropic_messages_client", return_value=MagicMock()), \
         patch.object(chat_chain, "_get_anthropic_model", return_value="claude-x"), \
         patch("app.settings.llm_provider", return_value="anthropic"), \
         patch("app.observability.anthropic_stream", new=create), \
         caplog.at_level(logging.WARNING, logger="app.chains.chat_chain"):
        await chat_chain.chat_reply(simple_profile, "populate it", [])

    warnings = [r.getMessage() for r in caplog.records if r.levelno == logging.WARNING]
    assert any(
        "not parseable JSON" in m and "end_turn" in m and "Absolutely!" in m
        for m in warnings
    ), warnings
    # And it must NOT masquerade as the truncation log.
    assert not any("output-token cap" in m for m in warnings)


@pytest.mark.asyncio
async def test_prose_only_reply_is_conversational_not_a_failure(simple_profile, caplog):
    """Regression (Langfuse trace 99d91a29): after a tool call the model often
    replies in plain prose — e.g. a clarifying question — instead of the JSON
    envelope. That is a legitimate conversational turn: it must be shown to the user
    VERBATIM, with no proposal, and MUST NOT be mis-reported as the 'unexpected
    format' failure (which hid the model's actual question)."""
    from app.chains import chat_chain

    question = (
        "I found 2 other profiles. Which one would you like to use as the source?\n\n"
        "1. **Junior Machine Learning Developer**\n2. **Senior Software Engineer**"
    )
    reply = MagicMock()
    reply.stop_reason = "end_turn"
    reply.content = [_text_block(question)]  # pure prose, no JSON envelope
    reply.usage = _usage(120, 40)
    create = AsyncMock(return_value=reply)

    with patch.object(chat_chain, "_build_anthropic_messages_client", return_value=MagicMock()), \
         patch.object(chat_chain, "_get_anthropic_model", return_value="claude-x"), \
         patch("app.settings.llm_provider", return_value="anthropic"), \
         patch("app.observability.anthropic_stream", new=create), \
         caplog.at_level(logging.WARNING, logger="app.chains.chat_chain"):
        result, _ = await chat_chain.chat_reply(
            simple_profile, "populate this profile based on my other one", []
        )

    assert result.reply == question  # shown verbatim
    assert result.proposal is None
    assert "unexpected format" not in result.reply
    # It is NOT a failure, so it must not log the unparseable warning.
    assert not any(
        "not parseable JSON" in r.getMessage()
        for r in caplog.records if r.levelno == logging.WARNING
    )


@pytest.mark.asyncio
async def test_langchain_truncated_edit_returns_split_nudge(simple_profile):
    """Generic provider that reports finish_reason 'length' → the truncation nudge."""
    from app.chains import chat_chain

    class _Resp:
        content = '{"reply": "here goes", "proposal": {"type": "edit"'  # invalid JSON
        usage_metadata = None
        response_metadata = {"finish_reason": "length"}  # cut off at token limit

    with patch.object(chat_chain, "_build_llm", return_value=MagicMock()), \
         patch("app.settings.llm_provider", return_value="openai"), \
         patch("app.observability.lc_invoke", new=AsyncMock(return_value=_Resp())), \
         patch("app.chains.chat_chain._llm_model_name", return_value="gpt-x"):
        result, _ = await chat_chain.chat_reply(
            simple_profile, "populate my whole profile", []
        )

    assert result.proposal is None
    assert "smaller edits" in result.reply


@pytest.mark.asyncio
async def test_langchain_unparseable_edit_is_distinct_from_truncation(simple_profile):
    """Generic provider that finished normally (finish_reason 'stop') but returned
    unparseable JSON → the DISTINCT 'unexpected format' message, not truncation."""
    from app.chains import chat_chain

    class _Resp:
        content = 'here is your edit: {not json'  # unparseable, not truncated
        usage_metadata = None
        response_metadata = {"finish_reason": "stop"}

    with patch.object(chat_chain, "_build_llm", return_value=MagicMock()), \
         patch("app.settings.llm_provider", return_value="openai"), \
         patch("app.observability.lc_invoke", new=AsyncMock(return_value=_Resp())), \
         patch("app.chains.chat_chain._llm_model_name", return_value="gpt-x"):
        result, _ = await chat_chain.chat_reply(simple_profile, "rename my title", [])

    assert result.proposal is None
    assert "unexpected format" in result.reply
    assert "smaller edits" not in result.reply

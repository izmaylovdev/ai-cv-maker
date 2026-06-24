import json
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

    async def capture(profile, msg, hist):
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

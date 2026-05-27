import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.schemas import ProfileInput, SkillInput


@pytest.fixture()
def simple_profile() -> ProfileInput:
    return ProfileInput(
        fullName="Jane Doe",
        title="Software Engineer",
        overview="8 years building backend systems.",
        location="Berlin",
        workExperiences=[],
        educations=[],
        skills=[SkillInput(name="Python"), SkillInput(name="Go")],
    )


# ---------------------------------------------------------------------------
# chat_reply — question (no proposal)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_chat_reply_question_returns_answer(simple_profile):
    from app.chains.chat_chain import chat_reply

    history = []
    message = "What skills do I have listed?"

    mock_response = MagicMock()
    mock_response.reply = "You have: Python, Go."
    mock_response.proposal = None

    with patch("app.chains.chat_chain._chat_with_llm", new=AsyncMock(return_value=mock_response)):
        result = await chat_reply(simple_profile, message, history)

    assert result.reply == "You have: Python, Go."
    assert result.proposal is None


# ---------------------------------------------------------------------------
# chat_reply — edit instruction (with proposal)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_chat_reply_edit_returns_proposal(simple_profile):
    from app.chains.chat_chain import chat_reply

    history = []
    message = "Add TypeScript to my skills"

    mock_proposal = MagicMock()
    mock_proposal.type = "add_skill"
    mock_proposal.description = "Add skill: TypeScript"
    mock_proposal.patch_json = json.dumps({"skills": [{"name": "TypeScript"}]})

    mock_response = MagicMock()
    mock_response.reply = "Here is the proposed change:"
    mock_response.proposal = mock_proposal

    with patch("app.chains.chat_chain._chat_with_llm", new=AsyncMock(return_value=mock_response)):
        result = await chat_reply(simple_profile, message, history)

    assert result.reply == "Here is the proposed change:"
    assert result.proposal is not None
    assert result.proposal.type == "add_skill"
    patch_data = json.loads(result.proposal.patch_json)
    assert patch_data["skills"][0]["name"] == "TypeScript"


# ---------------------------------------------------------------------------
# chat_reply — history is forwarded to LLM
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_chat_reply_passes_history(simple_profile):
    from app.chains.chat_chain import chat_reply, ChatMessage

    history = [
        ChatMessage(role="user", content="Hello"),
        ChatMessage(role="assistant", content="Hi there!"),
    ]
    message = "What is my title?"

    mock_response = MagicMock()
    mock_response.reply = "Your title is Software Engineer."
    mock_response.proposal = None

    captured: list = []

    async def capture(profile, msg, hist):
        captured.append(hist)
        return mock_response

    with patch("app.chains.chat_chain._chat_with_llm", new=capture):
        await chat_reply(simple_profile, message, history)

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

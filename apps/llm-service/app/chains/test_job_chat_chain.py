from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.chains.user_chat_chain import ProfileSummary

# US-EXT-4 — the side-panel (extension) chat is given the current page's job
# posting plus the user's profile summaries. It answers questions about the role
# and, on a cover-letter request, returns a `fill` proposal carrying the draft
# text. Mirrors the chat_chain test style (the internal LLM call is mocked).


@pytest.fixture()
def profiles() -> list[ProfileSummary]:
    return [
        ProfileSummary(
            name="Backend CV",
            title="Senior Engineer",
            overview="10 years building distributed systems.",
            skills=["Go", "TypeScript", "gRPC"],
        )
    ]


@pytest.mark.asyncio
async def test_job_chat_question_returns_answer_no_proposal(profiles):
    from app.chains.job_chat_chain import job_chat_reply

    mock_response = MagicMock()
    mock_response.reply = "This role wants strong Go and distributed-systems experience."
    mock_response.proposal = None

    with patch(
        "app.chains.job_chat_chain._job_chat_with_llm",
        new=AsyncMock(return_value=(mock_response, MagicMock())),
    ):
        result, _usage = await job_chat_reply(
            profiles,
            job_title="Senior Engineer",
            job_description="Build great things with Go and TypeScript.",
            field_context="cover letter",
            message="what does this role need?",
            history=[],
        )

    assert "Go" in result.reply
    assert result.proposal is None


@pytest.mark.asyncio
async def test_job_chat_cover_letter_returns_fill_proposal(profiles):
    from app.chains.job_chat_chain import job_chat_reply

    mock_proposal = MagicMock()
    mock_proposal.type = "fill"
    mock_proposal.description = "Cover letter draft"
    mock_proposal.text = "Dear Hiring Manager, I am excited to apply…"

    mock_response = MagicMock()
    mock_response.reply = "Here's a draft cover letter tailored to the role:"
    mock_response.proposal = mock_proposal

    with patch(
        "app.chains.job_chat_chain._job_chat_with_llm",
        new=AsyncMock(return_value=(mock_response, MagicMock())),
    ):
        result, _usage = await job_chat_reply(
            profiles,
            job_title="Senior Engineer",
            job_description="Build great things with Go and TypeScript.",
            field_context="cover letter",
            message="write me a cover letter",
            history=[],
        )

    assert result.proposal is not None
    assert result.proposal.type == "fill"
    assert result.proposal.text.startswith("Dear Hiring Manager")

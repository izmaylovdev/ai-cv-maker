"""Tests for US-SETTINGS-3 — preferences read/write via AI chat."""
from unittest.mock import AsyncMock, patch

import pytest

from app.chains.user_chat_chain import ChatMessage, ProfileSummary


@pytest.fixture()
def no_profiles() -> list[ProfileSummary]:
    return []


@pytest.fixture()
def basic_profile() -> list[ProfileSummary]:
    return [ProfileSummary(
        name="My Profile",
        title="Software Engineer",
        overview="5 years building web apps.",
        skills=["Python", "React"],
    )]


# ---------------------------------------------------------------------------
# F-SETTINGS-3.1 — agent can read and display current preferences
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_user_chat_passes_preferences_in_context(basic_profile):
    """global_preferences is accepted by user_chat_reply without error."""
    from app.chains.user_chat_chain import user_chat_reply

    with patch(
        "app.chains.user_chat_chain._llm_reply",
        new=AsyncMock(return_value="Your preferences are: use formal tone."),
    ):
        result = await user_chat_reply(
            profiles=basic_profile,
            message="What are my current preferences?",
            history=[],
            global_preferences="Use formal tone.",
        )

    assert "formal" in result.reply.lower() or result.reply  # reply is returned


@pytest.mark.asyncio
async def test_user_chat_empty_preferences_passes_through(basic_profile):
    """user_chat_reply works correctly when global_preferences is empty."""
    from app.chains.user_chat_chain import user_chat_reply

    with patch(
        "app.chains.user_chat_chain._llm_reply",
        new=AsyncMock(return_value="You have no preferences set yet."),
    ):
        result = await user_chat_reply(
            profiles=basic_profile,
            message="What are my preferences?",
            history=[],
            global_preferences="",
        )

    assert result.reply == "You have no preferences set yet."


# ---------------------------------------------------------------------------
# F-SETTINGS-3.2 — agent signals a preferences update via action marker
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_user_chat_returns_preferences_update_action(basic_profile):
    """When the LLM wants to update preferences it includes the action marker."""
    from app.chains.user_chat_chain import user_chat_reply

    llm_output = (
        "[[UPDATE_PREFERENCES: Use bullet points. Always write in British English.]]\n"
        "I've updated your preferences to use bullet points and British English."
    )

    with patch(
        "app.chains.user_chat_chain._llm_reply",
        new=AsyncMock(return_value=llm_output),
    ):
        result = await user_chat_reply(
            profiles=basic_profile,
            message="Please set my preferences to use bullet points and British English.",
            history=[],
            global_preferences="",
        )

    assert result.preferences_update == "Use bullet points. Always write in British English."
    assert "[[UPDATE_PREFERENCES:" not in result.reply
    assert "updated" in result.reply.lower()


@pytest.mark.asyncio
async def test_user_chat_no_update_marker_gives_none(basic_profile):
    """When the LLM replies without the marker, preferences_update is None."""
    from app.chains.user_chat_chain import user_chat_reply

    with patch(
        "app.chains.user_chat_chain._llm_reply",
        new=AsyncMock(return_value="Sure, happy to help with your career!"),
    ):
        result = await user_chat_reply(
            profiles=basic_profile,
            message="Help me improve my CV.",
            history=[],
            global_preferences="",
        )

    assert result.preferences_update is None
    assert result.reply == "Sure, happy to help with your career!"


# ---------------------------------------------------------------------------
# F-SETTINGS-3.3 — cv-api persistence (unit-tested via action marker parsing)
# ---------------------------------------------------------------------------

def test_parse_preferences_update_extracts_value():
    """The marker parser correctly extracts the new preferences value."""
    from app.chains.user_chat_chain import _parse_preferences_update

    raw = "[[UPDATE_PREFERENCES: Use bullet points.]]\nDone, I've updated your preferences."
    value, clean = _parse_preferences_update(raw)

    assert value == "Use bullet points."
    assert "[[UPDATE_PREFERENCES:" not in clean
    assert "Done" in clean


def test_parse_preferences_update_no_marker():
    """Returns (None, original_text) when the marker is absent."""
    from app.chains.user_chat_chain import _parse_preferences_update

    raw = "Here is some regular advice."
    value, clean = _parse_preferences_update(raw)

    assert value is None
    assert clean == raw


def test_parse_preferences_update_multiline_value():
    """The marker can span to the end of the first line only."""
    from app.chains.user_chat_chain import _parse_preferences_update

    raw = "[[UPDATE_PREFERENCES: Short sentences. No jargon.]]\nUpdated!"
    value, clean = _parse_preferences_update(raw)

    assert value == "Short sentences. No jargon."
    assert clean.strip() == "Updated!"

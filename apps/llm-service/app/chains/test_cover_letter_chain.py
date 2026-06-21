from unittest.mock import AsyncMock, patch

import pytest

from app.chains.usage import TokenUsage
from app.schemas import ProfileDocument, ProfileHeader

from .conftest import (
    entry_node,
    free_form_section,
    list_section,
    profile_document,
    timeline_section,
)

_EMPTY_USAGE = TokenUsage.empty()


@pytest.fixture()
def senior_backend_profile() -> ProfileDocument:
    return profile_document(
        header=ProfileHeader(fullName="Jane Doe", title="Senior Backend Engineer", location="Berlin"),
        sections=[
            free_form_section("Summary", "8 years building distributed systems in Python and Go."),
            timeline_section(
                "Work Experience",
                [entry_node("Backend Engineer · Acme Corp", "2018 – 2023",
                            "Led migration of monolith to microservices.")],
            ),
            list_section("Skills", ["Python", "Go", "Kubernetes"]),
        ],
    )


@pytest.fixture()
def junior_frontend_profile() -> ProfileDocument:
    return profile_document(
        header=ProfileHeader(fullName="Bob Smith", title="Junior Frontend Developer", location="London"),
        sections=[
            free_form_section("Summary", "2 years building React apps."),
            list_section("Skills", ["React", "TypeScript"]),
        ],
    )


# ---------------------------------------------------------------------------
# generate_cover_letter — single profile, returns text and profile id
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_generate_cover_letter_returns_text(senior_backend_profile):
    from app.chains.cover_letter_chain import generate_cover_letter, CoverLetterRequest

    request = CoverLetterRequest(
        profiles=[senior_backend_profile],
        profile_ids=["profile-1"],
        job_title="Senior Python Engineer",
        job_description="We need a Python expert with microservices experience.",
        field_context="cover letter",
    )

    with patch(
        "app.chains.cover_letter_chain._generate_with_llm",
        new=AsyncMock(return_value=("Dear Hiring Manager...", "profile-1", _EMPTY_USAGE)),
    ):
        result, _ = await generate_cover_letter(request)

    assert result.text.startswith("Dear")
    assert result.selected_profile_id == "profile-1"


# ---------------------------------------------------------------------------
# generate_cover_letter — multiple profiles, selects best match
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_generate_cover_letter_selects_best_profile(
    senior_backend_profile, junior_frontend_profile
):
    from app.chains.cover_letter_chain import generate_cover_letter, CoverLetterRequest

    request = CoverLetterRequest(
        profiles=[senior_backend_profile, junior_frontend_profile],
        profile_ids=["backend-id", "frontend-id"],
        job_title="Senior Backend Engineer",
        job_description="Looking for Python/Go expert with distributed systems experience.",
        field_context="cover letter",
    )

    with patch(
        "app.chains.cover_letter_chain._generate_with_llm",
        new=AsyncMock(return_value=("I am a strong fit...", "backend-id", _EMPTY_USAGE)),
    ):
        result, _ = await generate_cover_letter(request)

    assert result.selected_profile_id == "backend-id"


# ---------------------------------------------------------------------------
# generate_cover_letter — empty profiles list raises
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_generate_cover_letter_raises_on_empty_profiles():
    from app.chains.cover_letter_chain import generate_cover_letter, CoverLetterRequest

    request = CoverLetterRequest(
        profiles=[],
        profile_ids=[],
        job_title="Any Job",
        job_description="Some description.",
        field_context="cover letter",
    )

    with pytest.raises(ValueError, match="at least one profile"):
        await generate_cover_letter(request)


# ---------------------------------------------------------------------------
# generate_cover_letter — LLM error propagates
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_generate_cover_letter_propagates_llm_error(senior_backend_profile):
    from app.chains.cover_letter_chain import generate_cover_letter, CoverLetterRequest

    request = CoverLetterRequest(
        profiles=[senior_backend_profile],
        profile_ids=["profile-1"],
        job_title="Engineer",
        job_description="Some job.",
        field_context="cover letter",
    )

    with patch(
        "app.chains.cover_letter_chain._generate_with_llm",
        new=AsyncMock(side_effect=RuntimeError("LLM unavailable")),
    ):
        with pytest.raises(RuntimeError, match="LLM unavailable"):
            await generate_cover_letter(request)


# ---------------------------------------------------------------------------
# _SYSTEM_PROMPT guardrails — default rules must not contradict user
# preferences (e.g. "do not list my work experience", "facts not assumptions").
# The system prompt is the source of contradictions, so we assert on its text.
# ---------------------------------------------------------------------------

def test_system_prompt_does_not_force_listing_work_history():
    """The default rules must not mandate enumerating experience — that fights a
    common user preference of "do not list my work experience"."""
    from app.chains.cover_letter_chain import _SYSTEM_PROMPT

    lowered = _SYSTEM_PROMPT.lower()
    # The old mandate "Reference specific experience and skills..." reads as
    # "list the work history" and overrode the user's preference.
    assert "reference specific experience" not in lowered
    # Replacement must scope content to what's relevant, not the full history.
    assert "relevant" in lowered
    assert "do not enumerate" in lowered or "do not list" in lowered


def test_system_prompt_does_not_command_strong_fit_statement():
    """Opening must not force a "strong fit" assertion — that produces the
    "makes me a strong fit" assumption the user asked to avoid."""
    from app.chains.cover_letter_chain import _SYSTEM_PROMPT

    assert "strong fit statement" not in _SYSTEM_PROMPT.lower()


def test_system_prompt_does_not_force_enthusiasm_close():
    """No hardcoded enthusiastic close — it conflicts with a facts-only style."""
    from app.chains.cover_letter_chain import _SYSTEM_PROMPT

    lowered = _SYSTEM_PROMPT.lower()
    assert "enthusiasm" not in lowered


def test_system_prompt_preserves_output_contract():
    """Structural output rules are non-negotiable and must survive prompt edits."""
    from app.chains.cover_letter_chain import _SYSTEM_PROMPT

    assert "PROFILE_INDEX:" in _SYSTEM_PROMPT
    assert "COVER_LETTER:" in _SYSTEM_PROMPT

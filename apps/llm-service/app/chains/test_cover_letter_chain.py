from unittest.mock import AsyncMock, patch

import pytest

from app.chains.usage import TokenUsage
from app.schemas import ProfileInput, SkillInput, WorkExperienceInput

_EMPTY_USAGE = TokenUsage.empty()


@pytest.fixture()
def senior_backend_profile() -> ProfileInput:
    return ProfileInput(
        fullName="Jane Doe",
        title="Senior Backend Engineer",
        overview="8 years building distributed systems in Python and Go.",
        location="Berlin",
        workExperiences=[
            WorkExperienceInput(
                company="Acme Corp",
                role="Backend Engineer",
                startDate="2018-01-01",
                endDate="2023-12-31",
                description="Led migration of monolith to microservices.",
            )
        ],
        educations=[],
        skills=[SkillInput(name="Python"), SkillInput(name="Go"), SkillInput(name="Kubernetes")],
    )


@pytest.fixture()
def junior_frontend_profile() -> ProfileInput:
    return ProfileInput(
        fullName="Bob Smith",
        title="Junior Frontend Developer",
        overview="2 years building React apps.",
        location="London",
        workExperiences=[],
        educations=[],
        skills=[SkillInput(name="React"), SkillInput(name="TypeScript")],
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

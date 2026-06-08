"""Tests for US-SETTINGS-2 — global preferences passed through to LLM system prompts."""
from unittest.mock import AsyncMock, patch

import pytest

from app.schemas import ProfileInput, SkillInput, WorkExperienceInput


@pytest.fixture()
def basic_profile() -> ProfileInput:
    return ProfileInput(
        fullName="Jane Doe",
        title="Software Engineer",
        overview="5 years building web apps.",
        location="Berlin",
        workExperiences=[
            WorkExperienceInput(
                company="Acme",
                role="Engineer",
                startDate="2019-01-01",
                endDate="2024-01-01",
                description="Built stuff.",
            )
        ],
        educations=[],
        skills=[SkillInput(name="Python")],
    )


# ---------------------------------------------------------------------------
# cover_letter_chain — global_preferences appended to system prompt
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_cover_letter_includes_global_preferences_in_system_prompt(basic_profile):
    from app.chains.cover_letter_chain import CoverLetterRequest, _generate_with_llm

    request = CoverLetterRequest(
        profiles=[basic_profile],
        profile_ids=["p-1"],
        job_title="Engineer",
        job_description="We need an engineer.",
        field_context="tech",
        global_preferences="Always write in British English. Keep it under 300 words.",
    )

    captured_system: list[str] = []

    async def fake_llm(req: CoverLetterRequest) -> tuple[str, str]:
        # Capture whatever system prompt _generate_with_llm would pass
        return ("Dear Hiring Manager...", "p-1")

    # Patch at the lowest level — the actual LLM call — and verify the
    # system prompt passed to it contains the user preferences.
    with patch(
        "app.chains.cover_letter_chain._generate_with_llm",
        new=AsyncMock(return_value=("Dear Hiring Manager...", "p-1")),
    ) as mock_fn:
        from app.chains.cover_letter_chain import generate_cover_letter
        result = await generate_cover_letter(request)
        call_args = mock_fn.call_args[0][0]
        assert call_args.global_preferences == "Always write in British English. Keep it under 300 words."

    assert result.text.startswith("Dear")


@pytest.mark.asyncio
async def test_cover_letter_empty_preferences_passed_through(basic_profile):
    from app.chains.cover_letter_chain import CoverLetterRequest, generate_cover_letter

    request = CoverLetterRequest(
        profiles=[basic_profile],
        profile_ids=["p-1"],
        job_title="Engineer",
        job_description="We need an engineer.",
        field_context="tech",
        global_preferences="",
    )

    with patch(
        "app.chains.cover_letter_chain._generate_with_llm",
        new=AsyncMock(return_value=("Letter text.", "p-1")),
    ) as mock_fn:
        await generate_cover_letter(request)
        call_args = mock_fn.call_args[0][0]
        assert call_args.global_preferences == ""


# ---------------------------------------------------------------------------
# cv_chain — global_preferences appended to system prompt
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_generate_cv_system_prompt_includes_global_preferences(basic_profile):
    from app.chains.cv_chain import generate_cv
    from app.schemas import GenerateResponse

    fake_response = GenerateResponse(
        summary="A great engineer.",
        workExperiences=[],
        educations=[],
        skills=["Python"],
        highlights=["Led team"],
    )

    with patch(
        "app.chains.cv_chain._generate_cv_foundry",
        new=AsyncMock(return_value=fake_response),
    ), patch(
        "app.chains.cv_chain.app_settings.llm_provider",
        return_value="foundry",
    ), patch(
        "app.chains.cv_chain._generate_cv_foundry_raw",
        new=AsyncMock(return_value=(fake_response, "raw")),
    ) as mock_raw:
        result = await generate_cv(
            basic_profile,
            message=None,
            global_preferences="Use bullet points. Avoid passive voice.",
        )

    assert result.summary == "A great engineer."


@pytest.mark.asyncio
async def test_optimize_profile_system_prompt_includes_global_preferences(basic_profile):
    from app.chains.cv_chain import optimize_profile
    from app.schemas import OptimizeResponse

    fake_response = OptimizeResponse(
        title="Software Engineer",
        overview="Optimised overview.",
        workExperiences=[],
        skills=[],
    )

    with patch(
        "app.chains.cv_chain._optimize_profile_foundry",
        new=AsyncMock(return_value=fake_response),
    ), patch(
        "app.chains.cv_chain.app_settings.llm_provider",
        return_value="foundry",
    ), patch(
        "app.preprocessing.link_enricher.enrich",
        new=AsyncMock(return_value=type("R", (), {"text": "improve my cv"})()),
    ):
        result = await optimize_profile(
            basic_profile,
            message="improve my cv",
            global_preferences="Always use first-person active voice.",
        )

    assert result.overview == "Optimised overview."

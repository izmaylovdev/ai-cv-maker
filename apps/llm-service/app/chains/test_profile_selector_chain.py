from unittest.mock import AsyncMock, patch

import pytest

from app.chains.usage import TokenUsage
from app.schemas import ProfileInput, SkillInput, WorkExperienceInput

_EMPTY_USAGE = TokenUsage.empty()


@pytest.fixture()
def backend_profile() -> ProfileInput:
    return ProfileInput(
        id="prof-backend",
        fullName="Jane Doe",
        title="Senior Backend Engineer",
        overview="8 years building distributed Python and Go services.",
        location="Berlin",
        workExperiences=[
            WorkExperienceInput(
                company="Acme Corp",
                role="Backend Engineer",
                startDate="2018-01-01",
                endDate="2023-12-31",
                description="Led migration of monolith to microservices in Python.",
            )
        ],
        educations=[],
        skills=[SkillInput(name="Python"), SkillInput(name="Go"), SkillInput(name="gRPC")],
    )


@pytest.fixture()
def frontend_profile() -> ProfileInput:
    return ProfileInput(
        id="prof-frontend",
        fullName="Jane Doe",
        title="Frontend Developer",
        overview="5 years building React and Angular SPAs.",
        location="Berlin",
        workExperiences=[
            WorkExperienceInput(
                company="Startup Inc",
                role="Frontend Developer",
                startDate="2019-01-01",
                endDate="2023-12-31",
                description="Built customer-facing React dashboards.",
            )
        ],
        educations=[],
        skills=[SkillInput(name="React"), SkillInput(name="TypeScript"), SkillInput(name="Angular")],
    )


@pytest.fixture()
def backend_job_description() -> str:
    return (
        "We are hiring a Senior Python Backend Engineer. "
        "You will design gRPC services, build REST APIs, and maintain PostgreSQL databases. "
        "5+ years Python required. Go experience is a plus."
    )


@pytest.fixture()
def frontend_job_description() -> str:
    return (
        "We need a Frontend Engineer with React expertise. "
        "You will build interactive SPAs, collaborate with designers, and improve performance. "
        "3+ years React and TypeScript required."
    )


class TestSelectBestProfile:
    @pytest.mark.asyncio
    async def test_selects_backend_profile_for_backend_job(
        self,
        backend_profile: ProfileInput,
        frontend_profile: ProfileInput,
        backend_job_description: str,
    ) -> None:
        from app.chains.profile_selector_chain import select_best_profile

        llm_response = '{"selected_profile_id": "prof-backend"}'

        with patch(
            "app.chains.profile_selector_chain._build_llm",
            return_value=AsyncMock(ainvoke=AsyncMock(return_value=llm_response)),
        ):
            result = await select_best_profile(
                profiles=[backend_profile, frontend_profile],
                job_description=backend_job_description,
            )

        assert result.selected_profile_id == "prof-backend"

    @pytest.mark.asyncio
    async def test_selects_frontend_profile_for_frontend_job(
        self,
        backend_profile: ProfileInput,
        frontend_profile: ProfileInput,
        frontend_job_description: str,
    ) -> None:
        from app.chains.profile_selector_chain import select_best_profile

        llm_response = '{"selected_profile_id": "prof-frontend"}'

        with patch(
            "app.chains.profile_selector_chain._build_llm",
            return_value=AsyncMock(ainvoke=AsyncMock(return_value=llm_response)),
        ):
            result = await select_best_profile(
                profiles=[backend_profile, frontend_profile],
                job_description=frontend_job_description,
            )

        assert result.selected_profile_id == "prof-frontend"

    @pytest.mark.asyncio
    async def test_returns_single_profile_without_calling_llm(
        self,
        backend_profile: ProfileInput,
        backend_job_description: str,
    ) -> None:
        from app.chains.profile_selector_chain import select_best_profile

        with patch(
            "app.chains.profile_selector_chain._build_llm"
        ) as mock_build_llm:
            result = await select_best_profile(
                profiles=[backend_profile],
                job_description=backend_job_description,
            )

        mock_build_llm.assert_not_called()
        assert result.selected_profile_id == "prof-backend"

    @pytest.mark.asyncio
    async def test_raises_on_empty_profiles(
        self,
        backend_job_description: str,
    ) -> None:
        from app.chains.profile_selector_chain import select_best_profile

        with pytest.raises(ValueError, match="profile"):
            await select_best_profile(profiles=[], job_description=backend_job_description)

    @pytest.mark.asyncio
    async def test_raises_when_llm_returns_unknown_profile_id(
        self,
        backend_profile: ProfileInput,
        frontend_profile: ProfileInput,
        backend_job_description: str,
    ) -> None:
        from app.chains.profile_selector_chain import select_best_profile

        llm_response = '{"selected_profile_id": "prof-unknown"}'

        with patch(
            "app.chains.profile_selector_chain._build_llm",
            return_value=AsyncMock(ainvoke=AsyncMock(return_value=llm_response)),
        ):
            with pytest.raises(ValueError, match="prof-unknown"):
                await select_best_profile(
                    profiles=[backend_profile, frontend_profile],
                    job_description=backend_job_description,
                )

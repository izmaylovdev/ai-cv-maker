"""Tests for US-SETTINGS-2 — global preferences passed through to LLM system prompts."""
from unittest.mock import AsyncMock, MagicMock, patch

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


def _make_fake_message(text: str) -> MagicMock:
    """Fake Anthropic message response for client.messages.create."""
    content_block = MagicMock()
    content_block.type = "text"
    content_block.text = text
    usage = MagicMock()
    usage.input_tokens = 10
    usage.output_tokens = 20
    msg = MagicMock()
    msg.content = [content_block]
    msg.usage = usage
    return msg


# ---------------------------------------------------------------------------
# _generate_cv_foundry_raw — system prompt injection
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_generate_cv_foundry_raw_injects_preferences_into_system_prompt(basic_profile):
    from app.chains.cv_chain import _generate_cv_foundry_raw, _profile_to_prompt_vars

    fake_json = '{"summary":"S","workExperiences":[],"educations":[],"skills":[],"highlights":[]}'
    fake_msg = _make_fake_message(fake_json)

    with patch("app.chains.cv_chain._build_foundry_client") as mock_client_fn, \
         patch("app.chains.cv_chain.app_settings.foundry_model", return_value="claude-haiku-4-5"):
        mock_client = AsyncMock()
        mock_client.messages.create = AsyncMock(return_value=fake_msg)
        mock_client_fn.return_value = mock_client

        inputs = _profile_to_prompt_vars(basic_profile, None)
        await _generate_cv_foundry_raw(inputs, global_preferences="Always use British English.")

        call_kwargs = mock_client.messages.create.call_args[1]
        assert "User preferences (apply to all output):" in call_kwargs["system"]
        assert "Always use British English." in call_kwargs["system"]


@pytest.mark.asyncio
async def test_generate_cv_foundry_raw_no_preferences_leaves_system_prompt_unchanged(basic_profile):
    from app.chains.cv_chain import _generate_cv_foundry_raw, _profile_to_prompt_vars, _SYSTEM_PROMPT

    fake_json = '{"summary":"S","workExperiences":[],"educations":[],"skills":[],"highlights":[]}'
    fake_msg = _make_fake_message(fake_json)

    with patch("app.chains.cv_chain._build_foundry_client") as mock_client_fn, \
         patch("app.chains.cv_chain.app_settings.foundry_model", return_value="claude-haiku-4-5"):
        mock_client = AsyncMock()
        mock_client.messages.create = AsyncMock(return_value=fake_msg)
        mock_client_fn.return_value = mock_client

        inputs = _profile_to_prompt_vars(basic_profile, None)
        await _generate_cv_foundry_raw(inputs, global_preferences="")

        call_kwargs = mock_client.messages.create.call_args[1]
        assert call_kwargs["system"] == _SYSTEM_PROMPT
        assert "User preferences" not in call_kwargs["system"]


@pytest.mark.asyncio
async def test_generate_cv_foundry_raw_whitespace_only_preferences_not_injected(basic_profile):
    from app.chains.cv_chain import _generate_cv_foundry_raw, _profile_to_prompt_vars, _SYSTEM_PROMPT

    fake_json = '{"summary":"S","workExperiences":[],"educations":[],"skills":[],"highlights":[]}'
    fake_msg = _make_fake_message(fake_json)

    with patch("app.chains.cv_chain._build_foundry_client") as mock_client_fn, \
         patch("app.chains.cv_chain.app_settings.foundry_model", return_value="claude-haiku-4-5"):
        mock_client = AsyncMock()
        mock_client.messages.create = AsyncMock(return_value=fake_msg)
        mock_client_fn.return_value = mock_client

        inputs = _profile_to_prompt_vars(basic_profile, None)
        await _generate_cv_foundry_raw(inputs, global_preferences="   ")

        call_kwargs = mock_client.messages.create.call_args[1]
        assert "User preferences" not in call_kwargs["system"]


# ---------------------------------------------------------------------------
# _optimize_profile_foundry_raw — system prompt injection
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_optimize_foundry_raw_injects_preferences_into_system_prompt(basic_profile):
    from app.chains.cv_chain import _optimize_profile_foundry_raw, _build_optimize_inputs

    fake_json = '{"title":"T","overview":"O","workExperiences":[],"skills":[]}'
    fake_msg = _make_fake_message(fake_json)

    with patch("app.chains.cv_chain._build_foundry_client") as mock_client_fn, \
         patch("app.chains.cv_chain.app_settings.foundry_model", return_value="claude-haiku-4-5"):
        mock_client = AsyncMock()
        mock_client.messages.create = AsyncMock(return_value=fake_msg)
        mock_client_fn.return_value = mock_client

        inputs = _build_optimize_inputs(basic_profile, "help me get a senior role")
        await _optimize_profile_foundry_raw(inputs, global_preferences="Keep sentences under 20 words.")

        call_kwargs = mock_client.messages.create.call_args[1]
        assert "User preferences (apply to all output):" in call_kwargs["system"]
        assert "Keep sentences under 20 words." in call_kwargs["system"]


@pytest.mark.asyncio
async def test_optimize_foundry_raw_no_preferences_leaves_system_prompt_unchanged(basic_profile):
    from app.chains.cv_chain import _optimize_profile_foundry_raw, _build_optimize_inputs, _OPTIMIZE_SYSTEM_PROMPT

    fake_json = '{"title":"T","overview":"O","workExperiences":[],"skills":[]}'
    fake_msg = _make_fake_message(fake_json)

    with patch("app.chains.cv_chain._build_foundry_client") as mock_client_fn, \
         patch("app.chains.cv_chain.app_settings.foundry_model", return_value="claude-haiku-4-5"):
        mock_client = AsyncMock()
        mock_client.messages.create = AsyncMock(return_value=fake_msg)
        mock_client_fn.return_value = mock_client

        inputs = _build_optimize_inputs(basic_profile, "help me")
        await _optimize_profile_foundry_raw(inputs, global_preferences="")

        call_kwargs = mock_client.messages.create.call_args[1]
        assert call_kwargs["system"] == _OPTIMIZE_SYSTEM_PROMPT
        assert "User preferences" not in call_kwargs["system"]


# ---------------------------------------------------------------------------
# cover_letter _generate_with_llm — system prompt injection
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_cover_letter_generate_with_llm_injects_preferences(basic_profile):
    from app.chains.cover_letter_chain import CoverLetterRequest, _generate_with_llm

    fake_msg = _make_fake_message(
        "p-1\n---\nDear Hiring Manager, this is written in British English."
    )

    request = CoverLetterRequest(
        profiles=[basic_profile],
        profile_ids=["p-1"],
        job_title="Engineer",
        job_description="We need an engineer.",
        field_context="tech",
        global_preferences="Always write in British English.",
    )

    with patch("app.chains.cover_letter_chain._build_foundry_client") as mock_client_fn, \
         patch("app.chains.cover_letter_chain.app_settings.foundry_model", return_value="claude-haiku-4-5"), \
         patch("app.chains.cover_letter_chain.app_settings.llm_provider", return_value="foundry"):
        mock_client = AsyncMock()
        mock_client.messages.create = AsyncMock(return_value=fake_msg)
        mock_client_fn.return_value = mock_client

        await _generate_with_llm(request)

        call_kwargs = mock_client.messages.create.call_args[1]
        assert "Always write in British English." in call_kwargs["system"]


@pytest.mark.asyncio
async def test_cover_letter_generate_with_llm_no_preferences_clean_system_prompt(basic_profile):
    from app.chains.cover_letter_chain import CoverLetterRequest, _generate_with_llm, _SYSTEM_PROMPT

    fake_msg = _make_fake_message("p-1\n---\nDear Hiring Manager,")

    request = CoverLetterRequest(
        profiles=[basic_profile],
        profile_ids=["p-1"],
        job_title="Engineer",
        job_description="We need an engineer.",
        field_context="tech",
        global_preferences="",
    )

    with patch("app.chains.cover_letter_chain._build_foundry_client") as mock_client_fn, \
         patch("app.chains.cover_letter_chain.app_settings.foundry_model", return_value="claude-haiku-4-5"), \
         patch("app.chains.cover_letter_chain.app_settings.llm_provider", return_value="foundry"):
        mock_client = AsyncMock()
        mock_client.messages.create = AsyncMock(return_value=fake_msg)
        mock_client_fn.return_value = mock_client

        await _generate_with_llm(request)

        call_kwargs = mock_client.messages.create.call_args[1]
        assert call_kwargs["system"] == _SYSTEM_PROMPT
        assert "User preferences" not in call_kwargs["system"]


@pytest.mark.asyncio
async def test_cover_letter_preferences_placed_before_system_prompt(basic_profile):
    """Preferences must appear at the top of the system prompt so they override the default rules."""
    from app.chains.cover_letter_chain import CoverLetterRequest, _generate_with_llm, _SYSTEM_PROMPT

    fake_msg = _make_fake_message("PROFILE_INDEX: 0\nCOVER_LETTER: Short letter.")

    request = CoverLetterRequest(
        profiles=[basic_profile],
        profile_ids=["p-1"],
        job_title="Engineer",
        job_description="We need an engineer.",
        field_context="tech",
        global_preferences="Use 5 sentences max.",
    )

    with patch("app.chains.cover_letter_chain._build_foundry_client") as mock_client_fn, \
         patch("app.chains.cover_letter_chain.app_settings.foundry_model", return_value="claude-haiku-4-5"), \
         patch("app.chains.cover_letter_chain.app_settings.llm_provider", return_value="foundry"):
        mock_client = AsyncMock()
        mock_client.messages.create = AsyncMock(return_value=fake_msg)
        mock_client_fn.return_value = mock_client

        await _generate_with_llm(request)

        system = mock_client.messages.create.call_args[1]["system"]
        prefs_pos = system.index("Use 5 sentences max.")
        system_prompt_pos = system.index(_SYSTEM_PROMPT[:40])
        assert prefs_pos < system_prompt_pos, "preferences must appear before the default system prompt"


@pytest.mark.asyncio
async def test_cover_letter_system_prompt_has_no_hardcoded_length():
    """The default system prompt must not hardcode paragraph/sentence counts that would override user preferences."""
    from app.chains.cover_letter_chain import _SYSTEM_PROMPT

    assert "3" not in _SYSTEM_PROMPT or "3–4 paragraphs" not in _SYSTEM_PROMPT, \
        "system prompt must not hardcode '3-4 paragraphs' — it overrides length preferences"


# ---------------------------------------------------------------------------
# generate_cv / optimize_profile — preferences forwarded through dispatch
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_generate_cv_forwards_preferences_to_foundry(basic_profile):
    from app.chains.cv_chain import generate_cv
    from app.schemas import GenerateResponse
    from app.chains.usage import TokenUsage

    fake_response = GenerateResponse(
        summary="Great.", workExperiences=[], educations=[], skills=["Python"], highlights=["Led team"]
    )
    fake_usage = TokenUsage(prompt_tokens=10, completion_tokens=20, model_name="claude-haiku-4-5")

    with patch("app.chains.cv_chain._generate_cv_foundry", new=AsyncMock(return_value=(fake_response, fake_usage))) as mock_fn, \
         patch("app.chains.cv_chain.app_settings.llm_provider", return_value="foundry"):
        await generate_cv(basic_profile, message=None, global_preferences="Use bullet points.")
        _, called_prefs = mock_fn.call_args[0]
        assert called_prefs == "Use bullet points."


@pytest.mark.asyncio
async def test_generate_cv_forwards_empty_preferences_to_foundry(basic_profile):
    from app.chains.cv_chain import generate_cv
    from app.schemas import GenerateResponse
    from app.chains.usage import TokenUsage

    fake_response = GenerateResponse(
        summary="Great.", workExperiences=[], educations=[], skills=[], highlights=[]
    )
    fake_usage = TokenUsage(prompt_tokens=10, completion_tokens=20, model_name="claude-haiku-4-5")

    with patch("app.chains.cv_chain._generate_cv_foundry", new=AsyncMock(return_value=(fake_response, fake_usage))) as mock_fn, \
         patch("app.chains.cv_chain.app_settings.llm_provider", return_value="foundry"):
        await generate_cv(basic_profile, message=None, global_preferences="")
        _, called_prefs = mock_fn.call_args[0]
        assert called_prefs == ""


@pytest.mark.asyncio
async def test_optimize_profile_forwards_preferences_to_foundry(basic_profile):
    from app.chains.cv_chain import optimize_profile
    from app.schemas import OptimizeResponse
    from app.chains.usage import TokenUsage

    fake_response = OptimizeResponse(title="T", overview="O.", workExperiences=[], skills=[])
    fake_usage = TokenUsage(prompt_tokens=10, completion_tokens=20, model_name="claude-haiku-4-5")

    with patch("app.chains.cv_chain._optimize_profile_foundry", new=AsyncMock(return_value=(fake_response, fake_usage))) as mock_fn, \
         patch("app.chains.cv_chain.app_settings.llm_provider", return_value="foundry"), \
         patch("app.preprocessing.link_enricher.enrich", new=AsyncMock(return_value=type("R", (), {"text": "improve"})())):
        await optimize_profile(basic_profile, message="improve", global_preferences="Active voice only.")
        _, called_prefs = mock_fn.call_args[0]
        assert called_prefs == "Active voice only."

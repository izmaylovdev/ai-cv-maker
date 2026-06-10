from __future__ import annotations

import json
from dataclasses import dataclass

from app import settings as app_settings
from app.chains.cv_chain import (
    _anthropic_text_content,
    _build_foundry_client,
    _build_llm,
    _llm_model_name,
    _format_skills,
    _format_work_experiences,
)
from app.chains.usage import TokenUsage
from app.schemas import ProfileInput


@dataclass
class SelectBestProfileResult:
    selected_profile_id: str


_SYSTEM_PROMPT = """\
You are a career expert. Given a list of candidate profiles and a job description, \
select the single profile that best matches the job requirements.

Scoring criteria (in order of importance):
1. Skills overlap with required and preferred skills in the job description.
2. Job title / seniority alignment.
3. Domain / industry relevance.
4. Years of experience.

Return ONLY a JSON object with a single key, no explanation, no markdown fences:
{"selected_profile_id": "<id of the best-matching profile>"}
"""

_HUMAN_PROMPT = """\
Job Description:
{job_description}

Candidate profiles:
{profiles_text}
"""


def _format_profile(profile: ProfileInput) -> str:
    return "\n".join([
        f"ID: {profile.id}",
        f"Name: {profile.fullName}",
        f"Title: {profile.title}",
        f"Overview: {profile.overview}",
        f"Skills: {_format_skills(profile.skills)}",
        f"Experience:\n{_format_work_experiences(profile.workExperiences)}",
    ])


def _parse_response(raw: str, valid_ids: set[str]) -> str:
    text = raw.strip()
    # Strip markdown code fences if present
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    try:
        data = json.loads(text)
        profile_id = str(data["selected_profile_id"])
    except (json.JSONDecodeError, KeyError):
        raise ValueError(f"LLM returned unexpected format: {raw!r}")

    if profile_id not in valid_ids:
        raise ValueError(
            f"LLM selected profile id {profile_id!r} which is not in the provided profiles"
        )
    return profile_id


async def select_best_profile(
    profiles: list[ProfileInput],
    job_description: str,
) -> SelectBestProfileResult:
    if not profiles:
        raise ValueError("at least one profile is required for profile selection")

    if len(profiles) == 1:
        return SelectBestProfileResult(selected_profile_id=profiles[0].id)  # type: ignore[arg-type]

    valid_ids = {str(p.id) for p in profiles}
    profiles_text = "\n\n".join(_format_profile(p) for p in profiles)
    user_content = _HUMAN_PROMPT.format(
        job_description=job_description,
        profiles_text=profiles_text,
    )

    provider = app_settings.llm_provider()

    if provider in ("foundry", "anthropic_foundry", "azure_foundry"):
        model = app_settings.foundry_model()
        if not model:
            raise ValueError("Set LLM_MODEL or ANTHROPIC_FOUNDRY_DEPLOYMENT to your Foundry deployment name.")
        client = _build_foundry_client()
        message = await client.messages.create(
            model=model,
            max_tokens=256,
            temperature=0,
            system=_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_content}],
        )
        raw = _anthropic_text_content(message).strip()
    else:
        from langchain_core.messages import HumanMessage, SystemMessage
        llm = _build_llm()
        messages = [
            SystemMessage(content=_SYSTEM_PROMPT),
            HumanMessage(content=user_content),
        ]
        response = await llm.ainvoke(messages)
        raw = (str(response.content) if hasattr(response, "content") else str(response)).strip()

    profile_id = _parse_response(raw, valid_ids)
    return SelectBestProfileResult(selected_profile_id=profile_id)

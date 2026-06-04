from __future__ import annotations

from dataclasses import dataclass

from app import settings as app_settings
from app.chains.cv_chain import (
    _anthropic_text_content,
    _build_foundry_client,
    _build_llm,
    _format_educations,
    _format_skills,
    _format_work_experiences,
)
from app.schemas import ProfileInput


@dataclass
class CoverLetterRequest:
    profiles: list[ProfileInput]
    profile_ids: list[str]
    job_title: str
    job_description: str
    field_context: str


@dataclass
class CoverLetterResult:
    text: str
    selected_profile_id: str


_SYSTEM_PROMPT = """\
You are an expert career coach and professional cover letter writer. \
Your task has two steps:

1. Select the single most relevant candidate profile for the given job.
2. Write a concise, compelling cover letter (3–4 paragraphs) for that profile.

Rules:
- Choose the profile whose skills, title, and experience best match the job description.
- The cover letter must open with the candidate's name and a strong fit statement.
- Reference specific experience and skills that are relevant to the role.
- Close with enthusiasm and a call to action.
- Do NOT invent facts not present in the profile.
- Return ONLY two lines, no extra text:
  PROFILE_INDEX: <zero-based integer index of the chosen profile>
  COVER_LETTER: <the full cover letter text, may span multiple lines>
"""

_HUMAN_PROMPT = """\
Job Title: {job_title}
Job Description:
{job_description}

Field context: {field_context}

Candidate profiles:
{profiles_text}
"""


def _format_profile(profile: ProfileInput, index: int) -> str:
    lines = [
        f"--- Profile {index} ---",
        f"Name: {profile.fullName}",
        f"Title: {profile.title}",
        f"Overview: {profile.overview}",
        f"Skills: {_format_skills(profile.skills)}",
        f"Work Experience:\n{_format_work_experiences(profile.workExperiences)}",
        f"Education:\n{_format_educations(profile.educations)}",
    ]
    return "\n".join(lines)


def _parse_response(raw: str, profile_ids: list[str]) -> tuple[str, str]:
    lines = raw.strip().splitlines()
    index_line = next((l for l in lines if l.startswith("PROFILE_INDEX:")), None)
    letter_start = next((i for i, l in enumerate(lines) if l.startswith("COVER_LETTER:")), None)

    if index_line is None or letter_start is None:
        # Fallback: use first profile, treat entire response as cover letter
        return raw.strip(), profile_ids[0] if profile_ids else ""

    try:
        idx = int(index_line.split(":", 1)[1].strip())
        idx = max(0, min(idx, len(profile_ids) - 1))
    except (ValueError, IndexError):
        idx = 0

    first_letter_line = lines[letter_start].split(":", 1)[1].strip()
    rest = lines[letter_start + 1:]
    cover_letter = "\n".join([first_letter_line] + rest).strip()

    return cover_letter, profile_ids[idx]


async def _generate_with_llm(request: CoverLetterRequest) -> tuple[str, str]:
    profiles_text = "\n\n".join(
        _format_profile(p, i) for i, p in enumerate(request.profiles)
    )
    user_content = _HUMAN_PROMPT.format(
        job_title=request.job_title,
        job_description=request.job_description,
        field_context=request.field_context,
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
            max_tokens=1024,
            temperature=app_settings.llm_temperature(),
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
        raw = str(response.content).strip()

    return _parse_response(raw, request.profile_ids)


async def generate_cover_letter(request: CoverLetterRequest) -> CoverLetterResult:
    if not request.profiles:
        raise ValueError("at least one profile is required to generate a cover letter")

    text, selected_id = await _generate_with_llm(request)
    return CoverLetterResult(text=text, selected_profile_id=selected_id)

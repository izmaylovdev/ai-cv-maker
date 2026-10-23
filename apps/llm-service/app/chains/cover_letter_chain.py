from __future__ import annotations

from dataclasses import dataclass

from app import observability
from app import settings as app_settings
from app.chains.anthropic_cache import cached_system
from app.chains.usage import TokenUsage
from app.chains.cv_chain import (
    _anthropic_text_content,
    _build_anthropic_messages_client,
    _get_anthropic_model,
    _build_llm,
    _llm_model_name,
    _format_document,
)
from app.schemas import ProfileDocument


@dataclass
class CoverLetterRequest:
    profiles: list[ProfileDocument]
    profile_ids: list[str]
    job_title: str
    job_description: str
    field_context: str
    global_preferences: str = ""


@dataclass
class CoverLetterResult:
    text: str
    selected_profile_id: str


_SYSTEM_PROMPT = """\
You are an expert career coach writing short application messages for candidates. \
The text you produce is pasted directly into a free-text field on a job-application \
website — it is not a letter and not an email, so letter conventions would look out \
of place. Your task has two steps:

1. Select the single most relevant candidate profile for the given job.
2. Write a concise, compelling application message for that profile.

Content rules:
- Choose the profile whose skills, title, and experience best match the job description.
- Open directly with first-person content about the candidate's fit for the role.
- Mention only skills and accomplishments directly relevant to the role; do not enumerate the candidate's full work history.
- Do NOT invent facts not present in the profile.

Style rules (the text goes into a form field, not correspondence):
- No salutation line (e.g. "Dear Hiring Manager,").
- No sign-off phrase and no signature block (e.g. "Sincerely," followed by a name).
- No date, postal address, subject, or "Re:" lines.
- No bracketed placeholders such as [Company Name] — if a detail is unknown, omit it rather than templating it.

Return ONLY two lines, no extra text:
  PROFILE_INDEX: <zero-based integer index of the chosen profile>
  COVER_LETTER: <the full application message text, may span multiple lines>
"""

_HUMAN_PROMPT = """\
Job Title: {job_title}
Job Description:
{job_description}

Field context: {field_context}

Candidate profiles:
{profiles_text}
"""


def _format_profile(profile: ProfileDocument, index: int) -> str:
    return f"--- Profile {index} ---\n{_format_document(profile)}"


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


async def _generate_with_llm(request: CoverLetterRequest) -> tuple[str, str, TokenUsage]:
    profiles_text = "\n\n".join(
        _format_profile(p, i) for i, p in enumerate(request.profiles)
    )
    user_content = _HUMAN_PROMPT.format(
        job_title=request.job_title,
        job_description=request.job_description,
        field_context=request.field_context,
        profiles_text=profiles_text,
    )

    if request.global_preferences and request.global_preferences.strip():
        system_prompt = (
            f"User preferences — these OVERRIDE all other instructions below:\n"
            f"{request.global_preferences}\n\n"
            f"{_SYSTEM_PROMPT}"
        )
    else:
        system_prompt = _SYSTEM_PROMPT

    provider = app_settings.llm_provider()

    if provider in ("anthropic", "foundry", "anthropic_foundry", "azure_foundry"):
        model = _get_anthropic_model(provider)
        if not model:
            raise ValueError("Set LLM_MODEL or ANTHROPIC_FOUNDRY_DEPLOYMENT to your Foundry deployment name.")
        client = _build_anthropic_messages_client(provider)
        message = await observability.anthropic_create(
            client,
            name="cover_letter",
            model=model,
            max_tokens=1024,
            system=cached_system(system_prompt),
            messages=[{"role": "user", "content": user_content}],
        )
        raw = _anthropic_text_content(message).strip()
        usage = TokenUsage.from_anthropic(message.usage, model)
    else:
        from langchain_core.messages import HumanMessage, SystemMessage
        llm = _build_llm()
        messages = [
            SystemMessage(content=system_prompt),
            HumanMessage(content=user_content),
        ]
        response = await observability.lc_invoke(llm, messages, name="cover_letter")
        raw = str(response.content).strip()
        usage = TokenUsage.from_langchain_response(response, _llm_model_name())

    text, selected_id = _parse_response(raw, request.profile_ids)
    return text, selected_id, usage


async def generate_cover_letter(request: CoverLetterRequest) -> tuple[CoverLetterResult, TokenUsage]:
    if not request.profiles:
        raise ValueError("at least one profile is required to generate a cover letter")

    text, selected_id, usage = await _generate_with_llm(request)
    return CoverLetterResult(text=text, selected_profile_id=selected_id), usage

from __future__ import annotations

import re

from anthropic import AsyncAnthropicFoundry
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.prompts import ChatPromptTemplate
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_openai import ChatOpenAI
from pydantic import ValidationError

from app import settings as app_settings
from app.guards import guard_cv_text, guard_free_text
from app.schemas import (
    ExtractResponse,
    GenerateResponse,
    OptimizeResponse,
    ProfileInput,
)

_SYSTEM_PROMPT = """\
You are an expert CV writer and career coach. Your task is to transform a user's raw \
profile information into polished, professional CV.

Rules:
- Write in first person, present tense for current roles and past tense for previous roles.
- Be concise yet impactful — use action verbs and quantify achievements where possible.
- Ensure the summary is 2–4 sentences capturing the candidate's value proposition.
- Each work experience description should be 2–4 bullet-style sentences highlighting impact.
- Highlights should be 3–5 top career achievements or differentiators.
- Skills should be normalised names (e.g. "TypeScript" not "typescript").
- Return ONLY valid JSON matching the required schema. No markdown, no extra text.
"""

_HUMAN_PROMPT = """\
Transform the following profile into a polished CV.{message_context} Return a JSON object with:
- summary: string (professional summary, 2–4 sentences)
- workExperiences: array of {{ company, role, period, description }}
- educations: array of {{ institution, degree, field, period }}
- skills: array of skill name strings
- highlights: array of 3–5 achievement strings

Profile:
Name: {full_name}
Title: {title}
Location: {location}
Overview: {overview}

Work Experience:
{work_experiences}

Education:
{educations}

Skills:
{skills}
"""


def _format_work_experiences(experiences: list) -> str:
    if not experiences:
        return "No work experience provided."
    lines = []
    for w in experiences:
        end = w.endDate or "Present"
        lines.append(
            f"- {w.role} at {w.company} ({w.startDate} – {end})\n  {w.description}"
        )
    return "\n".join(lines)


def _format_educations(educations: list) -> str:
    if not educations:
        return "No education provided."
    lines = []
    for e in educations:
        end = str(e.endYear) if e.endYear else "Present"
        lines.append(
            f"- {e.degree} in {e.field} at {e.institution} ({e.startYear}–{end})"
        )
    return "\n".join(lines)


def _format_skills(skills: list) -> str:
    if not skills:
        return "No skills provided."
    return ", ".join(s.name if not s.level else f"{s.name} ({s.level})" for s in skills)


def _profile_to_prompt_vars(profile: ProfileInput, message: str | None = None) -> dict[str, str]:
    message_context = f" The candidate is targeting: {message}." if message and message.strip() else ""
    return {
        "message_context": message_context,
        "full_name": profile.fullName,
        "title": profile.title,
        "location": profile.location.strip() if profile.location and profile.location.strip() else "Not specified",
        "overview": profile.overview,
        "work_experiences": _format_work_experiences(profile.workExperiences),
        "educations": _format_educations(profile.educations),
        "skills": _format_skills(profile.skills),
    }


def _strip_optional_json_fence(raw: str) -> str:
    text = raw.strip()
    if not text.startswith("```"):
        return text
    text = re.sub(r"^```(?:json)?\s*", "", text, count=1, flags=re.IGNORECASE)
    text = re.sub(r"\s*```\s*$", "", text, count=1)
    return text.strip()


def _parse_generate_response_json(text: str) -> GenerateResponse:
    cleaned = _strip_optional_json_fence(text)
    try:
        return GenerateResponse.model_validate_json(cleaned)
    except (ValidationError, ValueError) as exc:
        snippet = text[:2000] + ("…" if len(text) > 2000 else "")
        raise ValueError(f"Model did not return valid CV JSON: {exc}\n---\n{snippet}") from exc


def _anthropic_text_content(message) -> str:
    parts: list[str] = []
    for block in message.content:
        if getattr(block, "type", None) == "text":
            parts.append(block.text)
    if not parts:
        raise ValueError("No text content in model response")
    return "".join(parts)


def _build_foundry_client() -> AsyncAnthropicFoundry:
    api_key = app_settings.foundry_api_key()
    if not api_key:
        raise ValueError(
            "ANTHROPIC_FOUNDRY_API_KEY is required when LLM_PROVIDER is foundry "
            "(Azure Foundry key from Keys and Endpoint)."
        )
    base_url = app_settings.foundry_base_url()
    resource = app_settings.foundry_resource()
    if base_url:
        return AsyncAnthropicFoundry(api_key=api_key, base_url=base_url)
    if resource:
        return AsyncAnthropicFoundry(api_key=api_key, resource=resource)
    raise ValueError(
        "Set ANTHROPIC_FOUNDRY_BASE_URL (full URL to .../anthropic) or "
        "ANTHROPIC_FOUNDRY_RESOURCE (resource name for *.services.ai.azure.com)."
    )


async def _generate_cv_foundry_raw(inputs: dict[str, str]):
    model = app_settings.foundry_model()
    if not model:
        raise ValueError(
            "Set LLM_MODEL or ANTHROPIC_FOUNDRY_DEPLOYMENT to your Foundry deployment name "
            "(e.g. claude-haiku-4-5)."
        )
    client = _build_foundry_client()
    user_content = _HUMAN_PROMPT.format(**inputs)
    message = await client.messages.create(
        model=model,
        max_tokens=app_settings.foundry_max_tokens(),
        temperature=app_settings.llm_temperature(),
        system=_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_content}],
    )
    return _parse_generate_response_json(_anthropic_text_content(message)), message.usage


async def _generate_cv_foundry(inputs: dict[str, str]) -> GenerateResponse:
    result, _ = await _generate_cv_foundry_raw(inputs)
    return result


def _build_llm() -> BaseChatModel:
    provider = app_settings.llm_provider()
    temperature = app_settings.llm_temperature()

    if provider in ("openai", "openai_compatible", "lm_studio", "lm-studio"):
        return ChatOpenAI(
            model=app_settings.openai_model(),
            temperature=temperature,
            api_key=app_settings.openai_api_key(),
            base_url=app_settings.openai_base_url(),
        )

    if provider == "azure_openai":
        from langchain_openai import AzureChatOpenAI
        return AzureChatOpenAI(
            azure_deployment=app_settings.foundry_model(),
            azure_endpoint=app_settings.foundry_base_url(),
            api_key=app_settings.foundry_api_key(),
            api_version=app_settings.azure_openai_api_version(),
            temperature=temperature,
        )

    if provider == "google":
        return ChatGoogleGenerativeAI(
            model=app_settings.google_model(),
            temperature=temperature,
        )

    if provider in ("foundry", "anthropic_foundry", "azure_foundry"):
        raise ValueError(
            "LLM_PROVIDER=foundry uses AsyncAnthropicFoundry directly, not LangChain; "
            "call generate_cv() which routes by provider."
        )

    raise ValueError(
        f"Unknown LLM_PROVIDER={provider!r}. Use 'google', 'openai', or 'foundry'."
    )


def build_cv_chain():
    llm = _build_llm()
    structured_llm = llm.with_structured_output(GenerateResponse)

    prompt = ChatPromptTemplate.from_messages(
        [("system", _SYSTEM_PROMPT), ("human", _HUMAN_PROMPT)]
    )

    return prompt | structured_llm


async def generate_cv(profile: ProfileInput, message: str | None = None) -> GenerateResponse:
    inputs = _profile_to_prompt_vars(profile, message)
    provider = app_settings.llm_provider()

    if provider in ("foundry", "anthropic_foundry", "azure_foundry"):
        return await _generate_cv_foundry(inputs)

    chain = build_cv_chain()
    result = await chain.ainvoke(inputs)
    return result


_OPTIMIZE_SYSTEM_PROMPT = """\
You are an expert career coach and CV writer. Your task is to optimize a user's profile \
to best match a specific job, role, or goal described in their message.

Rules:
- Refine the professional title to better reflect the target role if appropriate.
- Rewrite the overview to highlight the most relevant skills and achievements for the target.
- Improve each work experience description to emphasize impact and achievements most relevant to the target role.
- Use action verbs and quantify achievements where possible.
- Normalize skill names (e.g. "TypeScript" not "typescript") and prioritize skills relevant to the target role.
- Keep all factual data unchanged: company names, job roles, startDate, endDate values, institutions.
- Return ONLY valid JSON matching the required schema. No markdown, no extra text.
"""

_OPTIMIZE_HUMAN_PROMPT = """\
Optimize the following profile for this goal: {message}

Return a JSON object with:
- title: string (refined professional title)
- overview: string (optimized professional summary, 2–4 sentences tailored to the goal)
- workExperiences: array of {{ company, role, startDate, endDate, description }}
  (keep company/role/startDate/endDate exactly as given; only improve description)
- skills: array of {{ name }}
  (normalize names; order by relevance to the goal)

Current Profile:
Name: {full_name}
Title: {title}
Overview: {overview}

Work Experience:
{work_experiences}

Skills:
{skills}
"""


def _build_optimize_inputs(profile: ProfileInput, message: str) -> dict[str, str]:
    return {
        "message": message,
        "full_name": profile.fullName,
        "title": profile.title,
        "overview": profile.overview,
        "work_experiences": _format_work_experiences(profile.workExperiences),
        "skills": _format_skills(profile.skills),
    }


def _parse_optimize_response_json(text: str) -> OptimizeResponse:
    cleaned = _strip_optional_json_fence(text)
    try:
        return OptimizeResponse.model_validate_json(cleaned)
    except (ValidationError, ValueError) as exc:
        snippet = text[:2000] + ("…" if len(text) > 2000 else "")
        raise ValueError(f"Model did not return valid optimize JSON: {exc}\n---\n{snippet}") from exc


async def _optimize_profile_foundry_raw(inputs: dict[str, str]):
    model = app_settings.foundry_model()
    if not model:
        raise ValueError(
            "Set LLM_MODEL or ANTHROPIC_FOUNDRY_DEPLOYMENT to your Foundry deployment name."
        )
    client = _build_foundry_client()
    user_content = _OPTIMIZE_HUMAN_PROMPT.format(**inputs)
    message = await client.messages.create(
        model=model,
        max_tokens=app_settings.foundry_max_tokens(),
        temperature=app_settings.llm_temperature(),
        system=_OPTIMIZE_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_content}],
    )
    return _parse_optimize_response_json(_anthropic_text_content(message)), message.usage


async def _optimize_profile_foundry(inputs: dict[str, str]) -> OptimizeResponse:
    result, _ = await _optimize_profile_foundry_raw(inputs)
    return result


def build_optimize_chain():
    llm = _build_llm()
    structured_llm = llm.with_structured_output(OptimizeResponse)
    prompt = ChatPromptTemplate.from_messages(
        [("system", _OPTIMIZE_SYSTEM_PROMPT), ("human", _OPTIMIZE_HUMAN_PROMPT)]
    )
    return prompt | structured_llm


async def optimize_profile(profile: ProfileInput, message: str) -> OptimizeResponse:
    from app.preprocessing.link_enricher import enrich
    enriched = await enrich(message)
    inputs = _build_optimize_inputs(profile, enriched.text)
    provider = app_settings.llm_provider()

    if provider in ("foundry", "anthropic_foundry", "azure_foundry"):
        return await _optimize_profile_foundry(inputs)

    chain = build_optimize_chain()
    result = await chain.ainvoke(inputs)
    return result


_ENHANCE_SYSTEM_PROMPT = """\
You are an expert CV writer and career coach. Your task is to enhance a specific text field \
from a candidate's profile to make it more professional, impactful, and compelling for recruiters.

Rules:
- Preserve all factual information exactly (company names, titles, dates, technologies, numbers)
- Improve clarity, conciseness, and professional tone
- Use strong action verbs; quantify achievements where possible
- Do not invent new facts or responsibilities
- Return ONLY the enhanced text — no explanations, no labels, no markdown formatting
"""

_ENHANCE_HUMAN_PROMPT = """\
Enhance the following CV field.

Field context: {field_purpose}

Current text:
{content}

Return only the improved text, nothing else.
"""


async def _enhance_field_foundry_raw(content: str, field_purpose: str):
    guard_free_text(content, "content")
    guard_free_text(field_purpose, "field_purpose")
    model = app_settings.foundry_model()
    if not model:
        raise ValueError("Set LLM_MODEL or ANTHROPIC_FOUNDRY_DEPLOYMENT to your Foundry deployment name.")
    client = _build_foundry_client()
    user_content = _ENHANCE_HUMAN_PROMPT.format(content=content, field_purpose=field_purpose)
    message = await client.messages.create(
        model=model,
        max_tokens=1024,
        temperature=app_settings.llm_temperature(),
        system=_ENHANCE_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_content}],
    )
    return _anthropic_text_content(message).strip(), message.usage


async def _enhance_field_foundry(content: str, field_purpose: str) -> str:
    result, _ = await _enhance_field_foundry_raw(content, field_purpose)
    return result


async def enhance_field(content: str, field_purpose: str) -> str:
    provider = app_settings.llm_provider()

    if provider in ("foundry", "anthropic_foundry", "azure_foundry"):
        return await _enhance_field_foundry(content, field_purpose)

    llm = _build_llm()
    from langchain_core.messages import HumanMessage, SystemMessage
    messages = [
        SystemMessage(content=_ENHANCE_SYSTEM_PROMPT),
        HumanMessage(content=_ENHANCE_HUMAN_PROMPT.format(content=content, field_purpose=field_purpose)),
    ]
    response = await llm.ainvoke(messages)
    return str(response.content).strip()


_EXTRACT_SYSTEM_PROMPT = """\
You are an expert CV parser. Your task is to extract structured profile information \
from raw CV/resume text.

Rules:
- Extract all available information; use empty strings for missing text fields.
- For dates: use ISO format YYYY-MM-DD for work experience dates, integer years for education.
- If an end date is absent or says "present"/"current", omit it (null).
- Normalize skill names (e.g. "TypeScript" not "typescript").
- The overview should be the professional summary/objective if present, otherwise synthesize \
  a 2-3 sentence summary from the experience.
- Return ONLY valid JSON matching the required schema. No markdown, no extra text.
"""

_EXTRACT_HUMAN_PROMPT = """\
Extract the profile from the following CV text and return a JSON object with:
- fullName: string
- title: string (professional title/headline)
- overview: string (professional summary, 2-3 sentences)
- location: string or null
- contactEmail: string or null
- contactPhone: string or null
- workExperiences: array of {{ company, role, startDate (YYYY-MM-DD), endDate (YYYY-MM-DD or null), description }}
- educations: array of {{ institution, degree, field, startYear (int), endYear (int or null) }}
- skills: array of {{ name }}

CV Text:
{cv_text}
"""


def _parse_extract_response_json(text: str) -> ExtractResponse:
    cleaned = _strip_optional_json_fence(text)
    try:
        return ExtractResponse.model_validate_json(cleaned)
    except (ValidationError, ValueError) as exc:
        snippet = text[:2000] + ("…" if len(text) > 2000 else "")
        raise ValueError(f"Model did not return valid extract JSON: {exc}\n---\n{snippet}") from exc


async def _extract_profile_foundry_raw(cv_text: str):
    guard_cv_text(cv_text)
    model = app_settings.foundry_model()
    if not model:
        raise ValueError("Set LLM_MODEL or ANTHROPIC_FOUNDRY_DEPLOYMENT to your Foundry deployment name.")
    client = _build_foundry_client()
    user_content = _EXTRACT_HUMAN_PROMPT.format(cv_text=cv_text)
    message = await client.messages.create(
        model=model,
        max_tokens=app_settings.foundry_max_tokens(),
        temperature=0,
        system=_EXTRACT_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_content}],
    )
    return _parse_extract_response_json(_anthropic_text_content(message)), message.usage


async def _extract_profile_foundry(cv_text: str) -> ExtractResponse:
    result, _ = await _extract_profile_foundry_raw(cv_text)
    return result


def build_extract_chain():
    llm = _build_llm()
    structured_llm = llm.with_structured_output(ExtractResponse)
    prompt = ChatPromptTemplate.from_messages(
        [("system", _EXTRACT_SYSTEM_PROMPT), ("human", _EXTRACT_HUMAN_PROMPT)]
    )
    return prompt | structured_llm


async def extract_profile(cv_text: str) -> ExtractResponse:
    provider = app_settings.llm_provider()

    if provider in ("foundry", "anthropic_foundry", "azure_foundry"):
        return await _extract_profile_foundry(cv_text)

    chain = build_extract_chain()
    result = await chain.ainvoke({"cv_text": cv_text})
    return result

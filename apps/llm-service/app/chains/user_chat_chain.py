from __future__ import annotations

import re
from typing import Optional

from pydantic import BaseModel

from app import settings as app_settings
from app.chains.usage import TokenUsage
from app.guards import guard_chat_history, guard_chat_message
from app.chains.cv_chain import _build_foundry_client, _build_llm, _llm_model_name


class ChatMessage(BaseModel):
    role: str
    content: str


class UserChatResponse(BaseModel):
    reply: str
    preferences_update: Optional[str] = None


class ProfileSummary(BaseModel):
    name: str
    title: str
    overview: str
    skills: list[str]


_SYSTEM_PROMPT = """\
You are a helpful career assistant for a CV-maker application. You can see all of the \
user's job profiles and help them with career-related topics: reviewing their profiles, \
giving advice on job applications, professional development, comparing profiles for \
different positions, and general CV strategy.

Scope restriction: If the user asks about anything unrelated to their CVs, career, or \
professional development — including general knowledge, coding tasks, travel, or any other \
topic — politely decline and offer to help with their career instead.

Keep replies concise and helpful (1–4 sentences unless detail is explicitly requested). \
Do not invent information about the user's profiles beyond what is shown below.

Preferences management:
- If the user asks to see their current preferences, state them from the context provided.
- If the user asks to set, update, or change their global preferences, output EXACTLY one \
line at the very start of your reply in this format (no extra spaces):
  [[UPDATE_PREFERENCES: <the complete new preferences text>]]
  Then on the next line write your confirmation message to the user.
- Only use [[UPDATE_PREFERENCES: ...]] when the user explicitly asks to change preferences.
"""

_UPDATE_RE = re.compile(
    r"^\[\[UPDATE_PREFERENCES:\s*(?P<value>.+?)\]\]\n?",
    re.DOTALL,
)


def _parse_preferences_update(raw: str) -> tuple[str | None, str]:
    """Extract [[UPDATE_PREFERENCES: <value>]] from the start of a reply.

    Returns (new_value, cleaned_reply). If no marker is present returns
    (None, original_text).
    """
    m = _UPDATE_RE.match(raw)
    if not m:
        return None, raw
    value = m.group("value").strip()
    clean = raw[m.end():].strip()
    return value, clean


def _build_context(profiles: list[ProfileSummary], global_preferences: str) -> str:
    lines = []

    if global_preferences:
        lines.append(f"User's current global preferences: {global_preferences!r}\n")
    else:
        lines.append("User's current global preferences: (none set)\n")

    if not profiles:
        lines.append("The user has no profiles yet.")
    else:
        lines.append("User's job profiles:")
        for i, p in enumerate(profiles, 1):
            skills_str = ", ".join(p.skills) if p.skills else "none listed"
            lines.append(
                f"\n{i}. {p.name!r} — {p.title}\n"
                f"   Overview: {p.overview}\n"
                f"   Skills: {skills_str}"
            )

    return "\n".join(lines)


async def _llm_reply(
    system_prompt: str,
    messages: list[dict],
    provider: str,
) -> tuple[str, TokenUsage]:
    """Call the configured LLM and return the raw text reply with token usage."""
    if provider in ("foundry", "anthropic_foundry", "azure_foundry"):
        model = app_settings.foundry_model()
        client = _build_foundry_client()
        response = await client.messages.create(
            model=model,
            max_tokens=1024,
            temperature=app_settings.llm_temperature(),
            system=system_prompt,
            messages=messages,
        )
        text = "".join(
            block.text for block in response.content if getattr(block, "type", None) == "text"
        ).strip()
        return text, TokenUsage.from_anthropic(response.usage, model or "")

    llm = _build_llm()
    from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

    lc_messages = [SystemMessage(content=system_prompt)]
    for m in messages:
        if m["role"] == "user":
            lc_messages.append(HumanMessage(content=m["content"]))
        else:
            lc_messages.append(AIMessage(content=m["content"]))

    response = await llm.ainvoke(lc_messages)
    usage = TokenUsage.from_langchain_response(response, _llm_model_name())
    return str(response.content).strip(), usage


async def user_chat_reply(
    profiles: list[ProfileSummary],
    message: str,
    history: list[ChatMessage],
    global_preferences: str = "",
) -> tuple[UserChatResponse, TokenUsage]:
    guard_chat_message(message)
    history = guard_chat_history(history)

    provider = app_settings.llm_provider()
    context = _build_context(profiles, global_preferences)
    user_content = f"{context}\n\nUser message: {message}"

    messages: list[dict] = []
    for h in history:
        messages.append({"role": h.role, "content": h.content})
    messages.append({"role": "user", "content": user_content})

    raw, usage = await _llm_reply(_SYSTEM_PROMPT, messages, provider)
    preferences_update, clean_reply = _parse_preferences_update(raw)

    return UserChatResponse(reply=clean_reply, preferences_update=preferences_update), usage

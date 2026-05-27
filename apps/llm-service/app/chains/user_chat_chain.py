from __future__ import annotations

import json
from typing import Optional

from pydantic import BaseModel

from app import settings as app_settings
from app.guards import guard_chat_history, guard_chat_message
from app.chains.cv_chain import _build_foundry_client, _build_llm


class ChatMessage(BaseModel):
    role: str
    content: str


class UserChatResponse(BaseModel):
    reply: str


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
"""


def _build_context(profiles: list[ProfileSummary]) -> str:
    if not profiles:
        return "The user has no profiles yet."
    lines = ["User's job profiles:"]
    for i, p in enumerate(profiles, 1):
        skills_str = ", ".join(p.skills) if p.skills else "none listed"
        lines.append(
            f"\n{i}. {p.name!r} — {p.title}\n"
            f"   Overview: {p.overview}\n"
            f"   Skills: {skills_str}"
        )
    return "\n".join(lines)


async def user_chat_reply(
    profiles: list[ProfileSummary],
    message: str,
    history: list[ChatMessage],
) -> UserChatResponse:
    guard_chat_message(message)
    history = guard_chat_history(history)

    provider = app_settings.llm_provider()
    context = _build_context(profiles)
    user_content = f"{context}\n\nUser message: {message}"

    messages: list[dict] = []
    for h in history:
        messages.append({"role": h.role, "content": h.content})
    messages.append({"role": "user", "content": user_content})

    if provider in ("foundry", "anthropic_foundry", "azure_foundry"):
        model = app_settings.foundry_model()
        client = _build_foundry_client()
        response = await client.messages.create(
            model=model,
            max_tokens=1024,
            temperature=app_settings.llm_temperature(),
            system=_SYSTEM_PROMPT,
            messages=messages,
        )
        reply = "".join(
            block.text for block in response.content if getattr(block, "type", None) == "text"
        )
        return UserChatResponse(reply=reply.strip())

    llm = _build_llm()
    from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

    lc_messages = [SystemMessage(content=_SYSTEM_PROMPT)]
    for h in history:
        if h.role == "user":
            lc_messages.append(HumanMessage(content=h.content))
        else:
            lc_messages.append(AIMessage(content=h.content))
    lc_messages.append(HumanMessage(content=user_content))

    response = await llm.ainvoke(lc_messages)
    return UserChatResponse(reply=str(response.content).strip())

"""Input validation guards for LLM service endpoints.

All limits are chosen to cover legitimate use while blocking cost-abuse and
context-poisoning attacks. Length constants are in characters (not tokens).
"""

from __future__ import annotations

_MAX_CV_TEXT = 20_000       # ~15 pages of plain text / ~5 k tokens
_MAX_FREE_TEXT = 5_000      # overview, job descriptions, enhance content
_MAX_CHAT_MESSAGE = 2_000
_MAX_CHAT_HISTORY = 20      # turns kept; older turns are silently dropped


class InputTooLongError(ValueError):
    pass


class InvalidInputError(ValueError):
    pass


def guard_cv_text(text: str) -> str:
    if len(text) > _MAX_CV_TEXT:
        raise InputTooLongError(
            f"CV text is too long ({len(text):,} chars). Maximum is {_MAX_CV_TEXT:,}."
        )
    return text


def guard_free_text(text: str, field: str = "content") -> str:
    if len(text) > _MAX_FREE_TEXT:
        raise InputTooLongError(
            f"{field!r} is too long ({len(text):,} chars). Maximum is {_MAX_FREE_TEXT:,}."
        )
    return text


def guard_chat_message(text: str) -> str:
    if len(text) > _MAX_CHAT_MESSAGE:
        raise InputTooLongError(
            f"Message is too long ({len(text):,} chars). Maximum is {_MAX_CHAT_MESSAGE:,}."
        )
    return text


def guard_chat_history(history: list) -> list:
    """Validate roles and trim history to prevent context-poisoning."""
    for msg in history:
        if msg.role not in ("user", "assistant"):
            raise InvalidInputError(
                f"Invalid message role {msg.role!r}. Only 'user' and 'assistant' are permitted."
            )
    return history[-_MAX_CHAT_HISTORY:]

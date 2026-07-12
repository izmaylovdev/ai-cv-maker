"""US-AI-17 — Anthropic prompt-caching helpers.

Anthropic caches a prompt prefix only at explicit ``cache_control`` breakpoints.
A breakpoint may only sit on a content *block*, so a plain-string ``system`` (or
message content) must be converted to block form where a breakpoint is applied.
Only the Anthropic SDK path uses these helpers — the LangChain path (google /
openai / azure_openai) is untouched (F-AI-17.10).
"""

from __future__ import annotations

_CACHE_MARKER = {"type": "ephemeral"}


def cached_system(text: str) -> list[dict]:
    """Wrap a system prompt as a one-block list carrying the cache breakpoint.

    The block text is byte-identical to what was previously sent as the plain
    string, so the prompt itself is unchanged (F-AI-17.1).
    """
    return [{"type": "text", "text": text, "cache_control": _CACHE_MARKER}]


def mark_last_block(messages: list[dict]) -> list[dict]:
    """Return a copy of ``messages`` whose FINAL message carries a cache
    breakpoint on its last content block (F-AI-17.2).

    Non-destructive by design: the caller's list and message dicts are left
    untouched. In the chat tool loop the same message dicts are re-sent every
    iteration, so a breakpoint applied when a message was final must not linger
    on it once it becomes history — we shallow-copy at request-build time
    instead of mutating.

    String content is converted to block form (``[{"type": "text", ...}]``);
    list content (e.g. ``tool_result`` blocks) keeps its blocks and gets the
    marker on a copy of the last block dict.
    """
    if not messages:
        return messages
    final = dict(messages[-1])
    content = final["content"]
    if isinstance(content, str):
        blocks = [{"type": "text", "text": content, "cache_control": _CACHE_MARKER}]
    else:
        blocks = list(content)
        if not blocks:
            return messages
        blocks[-1] = {**blocks[-1], "cache_control": _CACHE_MARKER}
    final["content"] = blocks
    return [*messages[:-1], final]

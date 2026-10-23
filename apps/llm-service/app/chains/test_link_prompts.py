"""Prompt text for the block-tree schema: links are inline only.

The chat (patch) prompt and the CV / extract document schema must describe
links as `inlineLink` runs inside a `paragraph` (`paragraph → [text, inlineLink]`,
`inlineLink attrs {text,url}`) and must not offer a standalone `link` block
anywhere in the closed type set or the nesting rules.
"""
from __future__ import annotations

import re

from app.chains import chat_chain, cv_chain

_BARE_LINK = re.compile(r"(?<![A-Za-z])link(?![A-Za-z])")


def _chat_nesting_rules() -> dict[str, list[str]]:
    """Parse `parent → [a, b, c]` pairs from the chat system prompt."""
    text = chat_chain._SYSTEM_PROMPT
    return {
        parent: [t.strip() for t in children.split(",") if t.strip()]
        for parent, children in re.findall(r"(\w+) → \[([^\]]*)\]", text)
    }


def _cv_matrix() -> dict[str, str]:
    """Parse `- <type> ...` vocabulary lines from the CV document schema."""
    out: dict[str, str] = {}
    for line in cv_chain._DOCUMENT_SCHEMA.splitlines():
        m = re.match(r"-\s+(\w+)\s+(.*)$", line)
        if m:
            out[m.group(1)] = m.group(2)
    return out


def test_chat_prompt_mentions_inline_link_with_text_and_url():
    text = chat_chain._SYSTEM_PROMPT
    assert "inlineLink" in text
    assert re.search(r"inlineLink\.attrs\.\{text,\s*url\}", text)


def test_chat_prompt_nesting_puts_inline_link_inside_paragraph():
    rules = _chat_nesting_rules()
    assert rules["paragraph"] == ["text", "inlineLink"]


def test_chat_prompt_offers_no_standalone_link_block():
    rules = _chat_nesting_rules()
    for parent, children in rules.items():
        assert "link" not in children, f"{parent} still allows a standalone link block"
    closed_set = re.search(r"closed set:([^.]*)\.", chat_chain._SYSTEM_PROMPT)
    assert closed_set is not None
    assert not _BARE_LINK.search(closed_set.group(1)), closed_set.group(1)
    assert not re.search(r"(?<![A-Za-z])link\.attrs", chat_chain._SYSTEM_PROMPT)


def test_cv_schema_mentions_inline_link_inside_paragraph():
    matrix = _cv_matrix()
    assert "inlineLink" in matrix
    assert "text" in matrix["inlineLink"] and "url" in matrix["inlineLink"]
    assert "inlineLink" in matrix["paragraph"]


def test_cv_schema_offers_no_standalone_link_block():
    matrix = _cv_matrix()
    assert "link" not in matrix, "the vocabulary still lists a standalone `link` node"
    for parent in ("root", "listItem", "entry"):
        assert not _BARE_LINK.search(matrix[parent]), f"{parent}: {matrix[parent]}"

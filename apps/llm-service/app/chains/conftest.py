"""Shared test helpers for building well-formed ProfileDocument block trees
(ADR-0014). Mirrors the TypeScript factory shapes in
apps/profile-builder-ui/src/nodes.ts so tests construct valid documents
concisely. Each builder assigns a stable id from an incrementing counter so
documents pass validate_document (unique ids, required attrs)."""
from __future__ import annotations

from itertools import count

from app.schemas import BlockNode, ProfileDocument, ProfileHeader

_ids = count(1)


def _nid(prefix: str) -> str:
    return f"{prefix}-{next(_ids)}"


def text_node(text: str = "") -> BlockNode:
    return BlockNode(type="text", id=_nid("text"), attrs={"text": text})


def paragraph_node(text: str = "") -> BlockNode:
    return BlockNode(type="paragraph", id=_nid("para"), children=[text_node(text)])


def chip_node(text: str = "") -> BlockNode:
    return BlockNode(type="chip", id=_nid("chip"), attrs={"text": text})


def chips_node(texts: list[str]) -> BlockNode:
    return BlockNode(type="chips", id=_nid("chips"), children=[chip_node(t) for t in texts])


def list_item_node(text: str = "") -> BlockNode:
    return BlockNode(type="listItem", id=_nid("li"), children=[paragraph_node(text)])


def list_node(texts: list[str]) -> BlockNode:
    return BlockNode(type="list", id=_nid("list"), children=[list_item_node(t) for t in texts])


def entry_node(title: str = "", dates: str = "", description: str = "") -> BlockNode:
    return BlockNode(
        type="entry",
        id=_nid("entry"),
        attrs={"title": title, "dates": dates},
        children=[paragraph_node(description)],
    )


def timeline_node(entries: list[BlockNode]) -> BlockNode:
    return BlockNode(type="timeline", id=_nid("timeline"), children=entries)


def section_node(heading: str, children: list[BlockNode]) -> BlockNode:
    return BlockNode(type="section", id=_nid("section"), attrs={"heading": heading}, children=children)


def free_form_section(heading: str, body: str) -> BlockNode:
    """An old free-form section → a section with a single paragraph."""
    return section_node(heading, [paragraph_node(body)])


def list_section(heading: str, items: list[str]) -> BlockNode:
    """An old list section → a section with a list."""
    return section_node(heading, [list_node(items)])


def chip_list_section(heading: str, items: list[str]) -> BlockNode:
    """An old chip-list section → a section with chips."""
    return section_node(heading, [chips_node(items)])


def timeline_section(heading: str, entries: list[BlockNode]) -> BlockNode:
    """An old timeline section → a section with a timeline."""
    return section_node(heading, [timeline_node(entries)])


def root_node(sections: list[BlockNode]) -> BlockNode:
    return BlockNode(type="root", id=_nid("root"), children=sections)


def profile_document(
    *,
    sections: list[BlockNode],
    header: ProfileHeader | None = None,
    id: str | None = None,
) -> ProfileDocument:
    return ProfileDocument(
        id=id,
        header=header or ProfileHeader(),
        body=root_node(sections),
    )

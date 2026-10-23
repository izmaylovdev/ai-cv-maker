"""Schema tests for the canonical ProfileDocument block tree (ADR-0014, US-EDIT-19).

Focused on the chips section (the chip-list equivalent in the block-tree model):
a `title` heading node followed by a flat `chips` node directly under root, mirroring
the TypeScript reference in apps/profile-builder-ui/src/model.ts and nodes.ts.
"""

from app.schemas import BlockNode, ProfileDocument, ProfileHeader, validate_document


def _chips_section(heading: str, labels: list[str]) -> list[BlockNode]:
    """Returns a flat [title, chips] pair for root-level insertion (ADR-0014)."""
    return [
        BlockNode(type="title", id="t1", attrs={"text": heading}),
        BlockNode(
            type="chips",
            id="cs1",
            children=[
                BlockNode(type="chip", id=f"ci{i}", attrs={"text": label})
                for i, label in enumerate(labels, start=1)
            ],
        ),
    ]


def test_title_followed_by_chips_node():
    nodes = _chips_section("Skills", ["TypeScript", "React"])
    title, chips = nodes
    assert title.type == "title"
    assert title.attrs["text"] == "Skills"
    assert chips.type == "chips"
    assert [c.attrs["text"] for c in chips.children] == ["TypeScript", "React"]


def test_profile_document_round_trips_chips():
    doc = ProfileDocument.model_validate(
        {
            "header": {"fullName": "Ada Lovelace"},
            "body": {
                "type": "root",
                "id": "root-1",
                "children": [
                    {"type": "title", "id": "t1", "attrs": {"text": "Skills"}},
                    {
                        "type": "chips",
                        "id": "cs1",
                        "children": [
                            {"type": "chip", "id": "ci1", "attrs": {"text": "Python"}}
                        ],
                    },
                ],
            },
        }
    )
    title, chips = doc.body.children
    assert title.attrs["text"] == "Skills"
    assert chips.children[0].attrs["text"] == "Python"
    assert validate_document(doc) == []


def test_validate_document_rejects_unknown_node_type():
    doc = ProfileDocument(
        header=ProfileHeader(fullName="Ada"),
        body=BlockNode(
            type="root",
            id="root-1",
            children=[BlockNode(type="bogus", id="b1")],
        ),
    )
    errors = validate_document(doc)
    assert any("bogus" in e for e in errors)


# --- Links are inline only: the standalone `link` block is retired -----------
# A link is an `inlineLink` run inside a `paragraph`; a `link` node is rejected
# like any unknown type (mirrors model.ts and ProfileDocumentSchema.cs).


def _doc(*children: BlockNode) -> ProfileDocument:
    return ProfileDocument(
        header=ProfileHeader(fullName="Ada"),
        body=BlockNode(type="root", id="root-1", children=list(children)),
    )


def test_link_is_not_a_known_node_type():
    from app.schemas import ALLOWED_CHILDREN

    assert "link" not in ALLOWED_CHILDREN
    for parent in ("root", "listItem", "entry"):
        assert "link" not in ALLOWED_CHILDREN[parent]


def test_validate_document_rejects_link_at_root():
    doc = _doc(BlockNode(type="link", id="l1", attrs={"text": "Site", "url": "https://s.dev"}))
    errors = validate_document(doc)
    assert errors
    assert any("link" in e for e in errors)


def test_validate_document_rejects_link_inside_entry():
    entry = BlockNode(
        type="entry",
        id="e1",
        attrs={"title": "Engineer", "dates": "2022"},
        children=[BlockNode(type="link", id="l1", attrs={"text": "Case", "url": "https://c.dev"})],
    )
    doc = _doc(BlockNode(type="timeline", id="tl", children=[entry]))
    assert validate_document(doc)


def test_validate_document_accepts_paragraph_with_inline_link():
    para = BlockNode(
        type="paragraph",
        id="p1",
        children=[
            BlockNode(type="text", id="t1", attrs={"text": "See my "}),
            BlockNode(type="inlineLink", id="il1", attrs={"text": "portfolio", "url": "https://me.dev"}),
        ],
    )
    entry = BlockNode(
        type="entry",
        id="e1",
        attrs={"title": "Engineer", "dates": "2022"},
        children=[
            BlockNode(
                type="paragraph",
                id="p2",
                children=[BlockNode(type="inlineLink", id="il2", attrs={"text": "Case", "url": "https://c.dev"})],
            )
        ],
    )
    doc = _doc(para, BlockNode(type="timeline", id="tl", children=[entry]))
    assert validate_document(doc) == []

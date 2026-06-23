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

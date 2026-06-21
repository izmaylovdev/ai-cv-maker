"""Schema tests for the canonical ProfileDocument block tree (ADR-0014).

Focused on the chips section (the chip-list equivalent in the block-tree model):
a `section` holding a `chips` node whose children are `chip` leaves, mirroring
the TypeScript reference in apps/profile-builder-ui/src/model.ts and nodes.ts.
"""

from app.schemas import BlockNode, ProfileDocument, ProfileHeader, validate_document


def _chips_section(heading: str, labels: list[str]) -> BlockNode:
    return BlockNode(
        type="section",
        id="c1",
        attrs={"heading": heading},
        children=[
            BlockNode(
                type="chips",
                id="cs1",
                children=[
                    BlockNode(type="chip", id=f"ci{i}", attrs={"text": t})
                    for i, t in enumerate(labels, start=1)
                ],
            )
        ],
    )


def test_section_accepts_chips_node():
    section = _chips_section("Skills", ["TypeScript", "React"])
    chips = section.children[0]
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
                    {
                        "type": "section",
                        "id": "c1",
                        "attrs": {"heading": "Skills"},
                        "children": [
                            {
                                "type": "chips",
                                "id": "cs1",
                                "children": [
                                    {"type": "chip", "id": "ci1", "attrs": {"text": "Python"}}
                                ],
                            }
                        ],
                    }
                ],
            },
        }
    )
    section = doc.body.children[0]
    assert section.attrs["heading"] == "Skills"
    assert section.children[0].children[0].attrs["text"] == "Python"
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

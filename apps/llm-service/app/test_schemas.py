"""Schema tests for the canonical ProfileDocument (ADR-0013).

Focused on the chip-list section template (US-EDIT-13, F-EDIT-13): the document
model must accept `template: "chip-list"` with text-bearing items, mirroring the
TypeScript reference in apps/profile-builder-ui/src/model.ts.
"""

import pytest
from pydantic import ValidationError

from app.schemas import DocumentSection, ProfileDocument


def test_document_section_accepts_chip_list_template():
    section = DocumentSection(
        id="c1",
        template="chip-list",
        heading="Skills",
        items=[{"id": "ci1", "text": "TypeScript"}, {"id": "ci2", "text": "React"}],
    )
    assert section.template == "chip-list"
    assert section.items is not None
    assert [i.text for i in section.items] == ["TypeScript", "React"]


def test_profile_document_round_trips_chip_list():
    doc = ProfileDocument.model_validate(
        {
            "header": {"fullName": "Ada Lovelace"},
            "sections": [
                {
                    "id": "c1",
                    "template": "chip-list",
                    "heading": "Skills",
                    "items": [{"id": "ci1", "text": "Python"}],
                }
            ],
        }
    )
    assert doc.sections[0].template == "chip-list"


def test_unknown_template_is_rejected():
    with pytest.raises(ValidationError):
        DocumentSection(template="bogus")

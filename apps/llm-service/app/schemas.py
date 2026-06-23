from __future__ import annotations

from typing import Annotated, Optional

from pydantic import BaseModel, Field

_SHORT = 200    # names, titles, headings, chip labels
_LONG = 5_000   # free-text bodies and descriptions

# Canonical profile model (ADR-0014, amends ADR-0013 / §13): a fixed
# identity/contact `header` plus a `body` which is a recursive BlockNode tree.
# Mirrors the TypeScript BlockNode/ProfileDocument in
# apps/profile-builder-ui/src/model.ts and the C# CvApi.Domain.Entities —
# keep the three in sync. The TS file is the reference.
# US-EDIT-19: 'section' is retired; 'title' is the new flat heading node.

# Allowed child types per node type (§9.3 / §13 nesting matrix).
ALLOWED_CHILDREN: dict[str, list[str]] = {
    "root":     ["title", "paragraph", "list", "chips", "timeline", "link"],
    "title":    [],
    "paragraph": ["text"],
    "text":     [],
    "link":     [],
    "list":     ["listItem"],
    "listItem": ["paragraph", "list", "chips", "link"],
    "chips":    ["chip"],
    "chip":     [],
    "timeline": ["entry"],
    "entry":    ["paragraph", "list", "link"],
}

# Required `attrs` keys per node type (each value must be a string).
REQUIRED_ATTRS: dict[str, list[str]] = {
    "title": ["text"],
    "text":  ["text"],
    "link":  ["text", "url"],
    "chip":  ["text"],
    "entry": ["title", "dates"],
}

# Node types that introduce a new flow nesting level (matches the TS validator).
_FLOW_CONTAINERS = {"list", "timeline"}

# Default maximum flow nesting depth (§9.3).
DEFAULT_MAX_DEPTH = 4


class ProfileHeader(BaseModel):
    fullName: Annotated[str, Field(max_length=_SHORT)] = ""
    title: Annotated[str, Field(max_length=_SHORT)] = ""
    email: Annotated[str, Field(max_length=_SHORT)] = ""
    phone: Annotated[str, Field(max_length=_SHORT)] = ""
    location: Annotated[str, Field(max_length=_SHORT)] = ""


class BlockNode(BaseModel):
    """One node of the block tree. `type` is from the closed set; `attrs` carries
    type-specific leaf data (e.g. title→{text}, text→{text},
    entry→{title,dates}); `children` is ordered. Recursive."""

    type: str
    id: str = ""
    attrs: dict[str, Annotated[str, Field(max_length=_LONG)]] = Field(default_factory=dict)
    children: list["BlockNode"] = Field(default_factory=list)


class ProfileDocument(BaseModel):
    # Optional id, carried where a response must map back to a profile.
    id: Optional[str] = None
    header: ProfileHeader = Field(default_factory=ProfileHeader)
    body: BlockNode = Field(default_factory=lambda: BlockNode(type="root"))


# ---------------------------------------------------------------------------
# Schema validation (§9.3) — mirrors validateDocument in the TS reference.
# ---------------------------------------------------------------------------


def validate_document(doc: ProfileDocument, max_depth: int = DEFAULT_MAX_DEPTH) -> list[str]:
    """Validate the block tree against the §9.3 schema: closed type set, the
    allowed-children matrix, required attrs, and bounded flow depth. Returns a
    list of human-readable errors (empty == valid)."""
    errors: list[str] = []
    seen_ids: set[str] = set()

    body = doc.body
    if body.type != "root":
        errors.append(f'document.body must be a root node, got "{body.type}"')

    def visit(node: BlockNode, parent: Optional[str], depth: int) -> None:
        if node.type not in ALLOWED_CHILDREN:
            errors.append(f'unknown node type "{node.type}"')
            return
        if not node.id:
            errors.append(f'node of type "{node.type}" is missing a string id')
        elif node.id in seen_ids:
            errors.append(f'duplicate node id "{node.id}"')
        else:
            seen_ids.add(node.id)

        for key in REQUIRED_ATTRS.get(node.type, []):
            if not isinstance(node.attrs.get(key), str):
                errors.append(f'node "{node.type}" ({node.id}) is missing required attr "{key}"')

        if parent is not None and node.type not in ALLOWED_CHILDREN[parent]:
            errors.append(f'"{node.type}" is not allowed inside "{parent}"')

        allowed = ALLOWED_CHILDREN[node.type]
        if not allowed and node.children:
            errors.append(f'leaf node "{node.type}" ({node.id}) must not have children')

        next_depth = depth + 1 if node.type in _FLOW_CONTAINERS else depth
        if next_depth > max_depth:
            errors.append(f'nesting depth exceeds max of {max_depth} at "{node.type}" ({node.id})')
            return

        for child in node.children:
            visit(child, node.type, next_depth)

    visit(body, None, 0)
    return errors


# ---------------------------------------------------------------------------
# Request / response envelopes (unchanged shapes, new document type).
# ---------------------------------------------------------------------------


class GenerateRequest(BaseModel):
    profile: ProfileDocument
    message: Optional[str] = None


class GenerateResponse(BaseModel):
    document: ProfileDocument


class OptimizeRequest(BaseModel):
    profile: ProfileDocument
    message: str


class OptimizeResponse(BaseModel):
    document: ProfileDocument


class ExtractRequest(BaseModel):
    cv_text: str


class ExtractResponse(BaseModel):
    document: ProfileDocument

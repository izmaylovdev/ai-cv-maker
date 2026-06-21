from __future__ import annotations

from typing import Annotated, Literal, Optional

from pydantic import BaseModel, Field

_SHORT = 200    # names, titles, headings
_LONG = 5_000   # free-text bodies and descriptions

# Canonical profile model (ADR-0013): a document of freely added/removed/reordered
# sections plus a fixed identity/contact header. Mirrors the TypeScript
# ProfileDocument in apps/profile-builder-ui/src/model.ts and the C#
# CvApi.Domain.Entities.ProfileDocument — keep the three in sync.


class ProfileHeader(BaseModel):
    fullName: Annotated[str, Field(max_length=_SHORT)] = ""
    title: Annotated[str, Field(max_length=_SHORT)] = ""
    email: Annotated[str, Field(max_length=_SHORT)] = ""
    phone: Annotated[str, Field(max_length=_SHORT)] = ""
    location: Annotated[str, Field(max_length=_SHORT)] = ""


class SectionItem(BaseModel):
    id: str = ""
    # Timeline item fields.
    title: Optional[Annotated[str, Field(max_length=_SHORT)]] = None
    dates: Optional[Annotated[str, Field(max_length=_SHORT)]] = None
    description: Optional[Annotated[str, Field(max_length=_LONG)]] = None
    # List / chip-list item field.
    text: Optional[Annotated[str, Field(max_length=_SHORT)]] = None


class DocumentSection(BaseModel):
    id: str = ""
    # "chip-list" shares the "list" item shape (text items); the discriminant
    # drives chip/tag rendering on the client and PDF.
    template: Literal["free-form", "timeline", "list", "chip-list"] = "free-form"
    heading: Annotated[str, Field(max_length=_SHORT)] = ""
    body: Optional[Annotated[str, Field(max_length=_LONG)]] = None
    items: Optional[list[SectionItem]] = None


class ProfileDocument(BaseModel):
    # Optional id, carried where a response must map back to a profile.
    id: Optional[str] = None
    header: ProfileHeader = Field(default_factory=ProfileHeader)
    sections: list[DocumentSection] = Field(default_factory=list)


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

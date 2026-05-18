from __future__ import annotations

from datetime import date
from typing import Optional

from pydantic import BaseModel


class WorkExperienceInput(BaseModel):
    id: Optional[str] = None
    company: str
    role: str
    startDate: str
    endDate: Optional[str] = None
    description: str


class EducationInput(BaseModel):
    id: Optional[str] = None
    institution: str
    degree: str
    field: str
    startYear: int
    endYear: Optional[int] = None


class SkillInput(BaseModel):
    id: Optional[str] = None
    name: str
    level: Optional[str] = None


class ProfileInput(BaseModel):
    fullName: str
    title: str
    overview: str
    location: str | None = None
    workExperiences: list[WorkExperienceInput] = []
    educations: list[EducationInput] = []
    skills: list[SkillInput] = []


class GenerateRequest(BaseModel):
    profile: ProfileInput
    message: Optional[str] = None


class WorkExperienceOutput(BaseModel):
    company: str
    role: str
    period: str
    description: str


class EducationOutput(BaseModel):
    institution: str
    degree: str
    field: str
    period: str


class GenerateResponse(BaseModel):
    summary: str
    workExperiences: list[WorkExperienceOutput]
    educations: list[EducationOutput]
    skills: list[str]
    highlights: list[str]


class OptimizeRequest(BaseModel):
    profile: ProfileInput
    message: str


class OptimizeWorkExperience(BaseModel):
    company: str
    role: str
    startDate: str
    endDate: Optional[str] = None
    description: str


class OptimizeSkill(BaseModel):
    name: str


class OptimizeResponse(BaseModel):
    title: str
    overview: str
    workExperiences: list[OptimizeWorkExperience]
    skills: list[OptimizeSkill]


class ExtractRequest(BaseModel):
    cv_text: str


class ExtractWorkExperience(BaseModel):
    company: str
    role: str
    startDate: str
    endDate: Optional[str] = None
    description: str


class ExtractEducation(BaseModel):
    institution: str
    degree: str
    field: str
    startYear: int
    endYear: Optional[int] = None


class ExtractSkill(BaseModel):
    name: str


class ExtractResponse(BaseModel):
    fullName: str
    title: str
    overview: str
    location: Optional[str] = None
    contactEmail: Optional[str] = None
    contactPhone: Optional[str] = None
    workExperiences: list[ExtractWorkExperience] = []
    educations: list[ExtractEducation] = []
    skills: list[ExtractSkill] = []

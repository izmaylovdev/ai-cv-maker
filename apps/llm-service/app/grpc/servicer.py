import grpc

from app.chains.cv_chain import generate_cv, optimize_profile
from app.grpc import llm_service_pb2, llm_service_pb2_grpc
from app.schemas import (
    EducationInput,
    ProfileInput,
    SkillInput,
    WorkExperienceInput,
)


def _proto_to_profile(proto) -> ProfileInput:
    return ProfileInput(
        fullName=proto.full_name,
        title=proto.title,
        overview=proto.overview,
        location=proto.location or None,
        workExperiences=[
            WorkExperienceInput(
                id=w.id or None,
                company=w.company,
                role=w.role,
                startDate=w.start_date,
                endDate=w.end_date or None,
                description=w.description,
            )
            for w in proto.work_experiences
        ],
        educations=[
            EducationInput(
                id=e.id or None,
                institution=e.institution,
                degree=e.degree,
                field=e.field,
                startYear=e.start_year,
                endYear=e.end_year or None,
            )
            for e in proto.educations
        ],
        skills=[
            SkillInput(id=s.id or None, name=s.name, level=s.level or None)
            for s in proto.skills
        ],
    )


class LlmServiceImpl(llm_service_pb2_grpc.LlmServiceServicer):
    async def Generate(self, request, context):
        try:
            profile = _proto_to_profile(request.profile)
            result = await generate_cv(profile, request.message or None)
            return llm_service_pb2.GenerateResponse(
                summary=result.summary,
                work_experiences=[
                    llm_service_pb2.WorkExperienceOutput(
                        company=w.company,
                        role=w.role,
                        period=w.period,
                        description=w.description,
                    )
                    for w in result.workExperiences
                ],
                educations=[
                    llm_service_pb2.EducationOutput(
                        institution=e.institution,
                        degree=e.degree,
                        field=e.field,
                        period=e.period,
                    )
                    for e in result.educations
                ],
                skills=result.skills,
                highlights=result.highlights,
            )
        except Exception as exc:
            await context.abort(grpc.StatusCode.INTERNAL, str(exc))

    async def Optimize(self, request, context):
        try:
            profile = _proto_to_profile(request.profile)
            result = await optimize_profile(profile, request.message)
            return llm_service_pb2.OptimizeResponse(
                title=result.title,
                overview=result.overview,
                work_experiences=[
                    llm_service_pb2.OptimizeWorkExperienceOutput(
                        company=w.company,
                        role=w.role,
                        start_date=w.startDate,
                        end_date=w.endDate or "",
                        description=w.description,
                    )
                    for w in result.workExperiences
                ],
                skills=[
                    llm_service_pb2.OptimizeSkillOutput(name=s.name)
                    for s in result.skills
                ],
            )
        except Exception as exc:
            await context.abort(grpc.StatusCode.INTERNAL, str(exc))

    async def Health(self, request, context):
        return llm_service_pb2.HealthResponse(status="ok")

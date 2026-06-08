import grpc
from pydantic import ValidationError

from app.chains.chat_chain import ChatMessage, chat_reply
from app.chains.cover_letter_chain import CoverLetterRequest, generate_cover_letter
from app.chains.usage import TokenUsage
from app.chains.user_chat_chain import (
    ChatMessage as UserChatMessage,
    ProfileSummary,
    user_chat_reply,
)
from app.chains.cv_chain import enhance_field, extract_profile, generate_cv, optimize_profile
from app.preprocessing.link_enricher import LinkFetchError
from app.grpc import llm_service_pb2, llm_service_pb2_grpc
from app.guards import InputTooLongError, InvalidInputError
from app.schemas import (
    EducationInput,
    ProfileInput,
    SkillInput,
    WorkExperienceInput,
)

_INVALID_ARG_EXCEPTIONS = (ValidationError, InputTooLongError, InvalidInputError, LinkFetchError)


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


def _usage_proto(usage: TokenUsage):
    return llm_service_pb2.UsageMetadata(
        prompt_tokens=usage.prompt_tokens,
        completion_tokens=usage.completion_tokens,
        model_name=usage.model_name,
    )


class LlmServiceImpl(llm_service_pb2_grpc.LlmServiceServicer):
    async def Generate(self, request, context):
        try:
            profile = _proto_to_profile(request.profile)
            result, usage = await generate_cv(profile, request.message or None, getattr(request, "global_preferences", "") or "")
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
                usage=_usage_proto(usage),
            )
        except _INVALID_ARG_EXCEPTIONS as exc:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, str(exc))
        except Exception as exc:
            await context.abort(grpc.StatusCode.INTERNAL, str(exc))

    async def Optimize(self, request, context):
        try:
            profile = _proto_to_profile(request.profile)
            result, usage = await optimize_profile(profile, request.message, getattr(request, "global_preferences", "") or "")
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
                usage=_usage_proto(usage),
            )
        except _INVALID_ARG_EXCEPTIONS as exc:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, str(exc))
        except Exception as exc:
            await context.abort(grpc.StatusCode.INTERNAL, str(exc))

    async def ExtractProfile(self, request, context):
        try:
            result, usage = await extract_profile(request.cv_text)
            return llm_service_pb2.ExtractProfileResponse(
                full_name=result.fullName,
                title=result.title,
                overview=result.overview,
                location=result.location or "",
                contact_email=result.contactEmail or "",
                contact_phone=result.contactPhone or "",
                work_experiences=[
                    llm_service_pb2.ExtractWorkExperience(
                        company=w.company,
                        role=w.role,
                        start_date=w.startDate,
                        end_date=w.endDate or "",
                        description=w.description,
                    )
                    for w in result.workExperiences
                ],
                educations=[
                    llm_service_pb2.ExtractEducation(
                        institution=e.institution,
                        degree=e.degree,
                        field=e.field,
                        start_year=e.startYear,
                        end_year=e.endYear or 0,
                    )
                    for e in result.educations
                ],
                skills=[
                    llm_service_pb2.ExtractSkill(name=s.name)
                    for s in result.skills
                ],
                usage=_usage_proto(usage),
            )
        except _INVALID_ARG_EXCEPTIONS as exc:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, str(exc))
        except Exception as exc:
            await context.abort(grpc.StatusCode.INTERNAL, str(exc))

    async def EnhanceField(self, request, context):
        try:
            enhanced, usage = await enhance_field(request.content, request.field_purpose)
            return llm_service_pb2.EnhanceFieldResponse(enhanced=enhanced, usage=_usage_proto(usage))
        except _INVALID_ARG_EXCEPTIONS as exc:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, str(exc))
        except Exception as exc:
            await context.abort(grpc.StatusCode.INTERNAL, str(exc))

    async def Chat(self, request, context):
        try:
            profile = _proto_to_profile(request.profile)
            history = [ChatMessage(role=m.role, content=m.content) for m in request.history]
            result, usage = await chat_reply(profile, request.message, history)
            proposal = llm_service_pb2.ChatProposal(
                type=result.proposal.type,
                description=result.proposal.description,
                patch_json=result.proposal.patch_json,
            ) if result.proposal else llm_service_pb2.ChatProposal()
            return llm_service_pb2.ChatResponse(reply=result.reply, proposal=proposal, usage=_usage_proto(usage))
        except _INVALID_ARG_EXCEPTIONS as exc:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, str(exc))
        except Exception as exc:
            await context.abort(grpc.StatusCode.INTERNAL, str(exc))

    async def UserChat(self, request, context):
        try:
            profiles = [
                ProfileSummary(
                    name=p.name,
                    title=p.title,
                    overview=p.overview,
                    skills=list(p.skills),
                )
                for p in request.profiles
            ]
            history = [UserChatMessage(role=m.role, content=m.content) for m in request.history]
            result, usage = await user_chat_reply(
                profiles,
                request.message,
                history,
                global_preferences=getattr(request, "global_preferences", "") or "",
            )
            return llm_service_pb2.UserChatResponse(
                reply=result.reply,
                preferences_update=result.preferences_update or "",
                usage=_usage_proto(usage),
            )
        except _INVALID_ARG_EXCEPTIONS as exc:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, str(exc))
        except Exception as exc:
            await context.abort(grpc.StatusCode.INTERNAL, str(exc))

    async def GenerateCoverLetter(self, request, context):
        try:
            profiles = [_proto_to_profile(p) for p in request.profiles]
            result, usage = await generate_cover_letter(CoverLetterRequest(
                profiles=profiles,
                profile_ids=list(request.profile_ids),
                job_title=request.job_title,
                job_description=request.job_description,
                field_context=request.field_context,
                global_preferences=getattr(request, "global_preferences", "") or "",
            ))
            return llm_service_pb2.CoverLetterResponse(
                text=result.text,
                selected_profile_id=result.selected_profile_id,
                usage=_usage_proto(usage),
            )
        except _INVALID_ARG_EXCEPTIONS as exc:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, str(exc))
        except Exception as exc:
            await context.abort(grpc.StatusCode.INTERNAL, str(exc))

    async def Health(self, request, context):
        return llm_service_pb2.HealthResponse(status="ok")

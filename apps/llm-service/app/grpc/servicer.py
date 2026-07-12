import grpc
from pydantic import ValidationError

from app.chains.chat_chain import ChatMessage, OtherProfile, chat_reply
from app.chains.cover_letter_chain import CoverLetterRequest, generate_cover_letter
from app.chains.job_chat_chain import job_chat_reply
from app.chains.profile_selector_chain import select_best_profile
from app.chains.usage import TokenUsage
from app.chains.user_chat_chain import (
    ChatMessage as UserChatMessage,
    ProfileSummary,
    user_chat_reply,
)
from app.chains.cv_chain import extract_profile, generate_cv
from app.grpc import llm_service_pb2, llm_service_pb2_grpc
from app.guards import InputTooLongError, InvalidInputError
from app.schemas import (
    BlockNode,
    ProfileDocument,
    ProfileHeader,
)

_INVALID_ARG_EXCEPTIONS = (ValidationError, InputTooLongError, InvalidInputError)


def _proto_node_to_block(node) -> BlockNode:
    # Recursively map a proto ProfileNode into a BlockNode (ADR-0014 §9.2).
    return BlockNode(
        type=node.type,
        id=node.id,
        attrs=dict(node.attrs),
        children=[_proto_node_to_block(c) for c in node.children],
    )


def _proto_to_document(proto) -> ProfileDocument:
    header = proto.header
    body = (
        _proto_node_to_block(proto.body)
        if proto.HasField("body")
        else BlockNode(type="root")
    )
    return ProfileDocument(
        id=proto.id or None,
        header=ProfileHeader(
            fullName=header.full_name,
            title=header.title,
            email=header.email,
            phone=header.phone,
            location=header.location,
        ),
        body=body,
    )


def _block_to_proto_node(node: BlockNode):
    return llm_service_pb2.ProfileNode(
        type=node.type,
        id=node.id,
        attrs=dict(node.attrs),
        children=[_block_to_proto_node(c) for c in node.children],
    )


def _document_to_proto(doc: ProfileDocument):
    return llm_service_pb2.ProfileDocumentProto(
        id=doc.id or "",
        header=llm_service_pb2.ProfileHeaderProto(
            full_name=doc.header.fullName,
            title=doc.header.title,
            email=doc.header.email,
            phone=doc.header.phone,
            location=doc.header.location,
        ),
        body=_block_to_proto_node(doc.body),
    )


def _usage_proto(usage: TokenUsage):
    return llm_service_pb2.UsageMetadata(
        prompt_tokens=usage.prompt_tokens,
        completion_tokens=usage.completion_tokens,
        model_name=usage.model_name,
        cache_read_tokens=usage.cache_read_tokens,
        cache_write_tokens=usage.cache_write_tokens,
    )


class LlmServiceImpl(llm_service_pb2_grpc.LlmServiceServicer):
    async def Generate(self, request, context):
        try:
            profile = _proto_to_document(request.profile)
            result, usage = await generate_cv(
                profile, request.message or None, getattr(request, "global_preferences", "") or ""
            )
            return llm_service_pb2.GenerateResponse(
                document=_document_to_proto(result.document),
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
                document=_document_to_proto(result.document),
                usage=_usage_proto(usage),
            )
        except _INVALID_ARG_EXCEPTIONS as exc:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, str(exc))
        except Exception as exc:
            await context.abort(grpc.StatusCode.INTERNAL, str(exc))

    async def Chat(self, request, context):
        try:
            profile = _proto_to_document(request.profile)
            history = [ChatMessage(role=m.role, content=m.content) for m in request.history]
            # US-AI-13 — the user's other saved profiles, for on-demand tool reads.
            other_profiles = [
                OtherProfile(id=p.id, name=p.name, document=_proto_to_document(p.document))
                for p in request.other_profiles
            ]
            result, usage = await chat_reply(profile, request.message, history, other_profiles)
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

    async def JobChat(self, request, context):
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
            result, usage = await job_chat_reply(
                profiles,
                job_title=request.job_title,
                job_description=request.job_description,
                field_context=request.field_context,
                message=request.message,
                history=history,
            )
            proposal = llm_service_pb2.ChatProposal(
                type=result.proposal.type,
                description=result.proposal.description,
                text=result.proposal.text,
            ) if result.proposal else llm_service_pb2.ChatProposal()
            return llm_service_pb2.JobChatResponse(
                reply=result.reply,
                proposal=proposal,
                usage=_usage_proto(usage),
            )
        except _INVALID_ARG_EXCEPTIONS as exc:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, str(exc))
        except Exception as exc:
            await context.abort(grpc.StatusCode.INTERNAL, str(exc))

    async def GenerateCoverLetter(self, request, context):
        try:
            profiles = [_proto_to_document(p) for p in request.profiles]
            result, usage = await generate_cover_letter(CoverLetterRequest(
                profiles=profiles,
                profile_ids=[p.id or "" for p in profiles],
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

    async def SelectBestProfile(self, request, context):
        try:
            profiles = [_proto_to_document(p) for p in request.profiles]
            result = await select_best_profile(
                profiles=profiles,
                job_description=request.job_description,
            )
            return llm_service_pb2.SelectBestProfileResponse(profile_id=result.selected_profile_id)
        except ValueError as exc:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, str(exc))
        except Exception as exc:
            await context.abort(grpc.StatusCode.INTERNAL, str(exc))

    async def Health(self, request, context):
        return llm_service_pb2.HealthResponse(status="ok")

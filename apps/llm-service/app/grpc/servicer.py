import grpc
from pydantic import ValidationError

from app.chains.chat_chain import ChatMessage, chat_reply
from app.chains.cover_letter_chain import CoverLetterRequest, generate_cover_letter
from app.chains.profile_selector_chain import select_best_profile
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
    BlockNode,
    ProfileDocument,
    ProfileHeader,
)

_INVALID_ARG_EXCEPTIONS = (ValidationError, InputTooLongError, InvalidInputError, LinkFetchError)


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

    async def Optimize(self, request, context):
        try:
            profile = _proto_to_document(request.profile)
            result, usage = await optimize_profile(
                profile, request.message, getattr(request, "global_preferences", "") or ""
            )
            return llm_service_pb2.OptimizeResponse(
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
            profile = _proto_to_document(request.profile)
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

using System.Diagnostics;
using System.Security.Claims;
using CvApi.Domain.Entities;
using CvApi.Grpc;
using Grpc.Core;
using Microsoft.AspNetCore.Http;
using Polly;
using Polly.Registry;

namespace CvApi.Infrastructure.ExternalServices.Llm;

public class LlmService(
    CvApi.Grpc.LlmService.LlmServiceClient grpcClient,
    IHttpContextAccessor httpContextAccessor,
    ResiliencePipelineProvider<string> pipelineProvider) : ILlmService
{
    /// <summary>Key used to register the Polly resilience pipeline in DI.</summary>
    public const string ResiliencePipelineKey = "llm-grpc";

    private static readonly TimeSpan CallDeadline = TimeSpan.FromSeconds(60);

    private ResiliencePipeline Pipeline => pipelineProvider.GetPipeline(ResiliencePipelineKey);

    /// <summary>
    /// Per-call options carrying the deadline plus Langfuse trace-context headers
    /// (ADR-0010): the active OpenTelemetry trace id and the authenticated user id,
    /// so the llm-service Langfuse trace correlates with the Tempo trace (ADR-0016)
    /// for the same request. The gRPC client instrumentation separately injects the
    /// W3C <c>traceparent</c> that nests llm-service's spans under this trace.
    /// When <paramref name="sessionId"/> is set (the chat widget's per-conversation
    /// id, US-AI-16) it rides as <c>x-session-id</c> so all messages in one
    /// conversation group under a single Langfuse Session; a null/empty id adds no
    /// header.
    /// </summary>
    private CallOptions BuildCallOptions(string? sessionId)
    {
        var metadata = new Metadata();
        var traceId = Activity.Current?.TraceId.ToString();
        if (!string.IsNullOrEmpty(traceId))
            metadata.Add("x-trace-id", traceId);
        var userId = httpContextAccessor.HttpContext?.User?.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!string.IsNullOrEmpty(userId))
            metadata.Add("x-user-id", userId);
        if (!string.IsNullOrEmpty(sessionId))
            metadata.Add("x-session-id", sessionId);
        return new CallOptions(headers: metadata, deadline: DateTime.UtcNow.Add(CallDeadline));
    }


    private static LlmTokenUsage MapUsage(CvApi.Grpc.UsageMetadata? usage) =>
        usage is null
            ? LlmTokenUsage.Empty
            : new LlmTokenUsage(usage.PromptTokens, usage.CompletionTokens, usage.ModelName, usage.CacheReadTokens, usage.CacheWriteTokens);

    /// <summary>
    /// Executes <paramref name="grpcCall"/> inside the Polly resilience pipeline and
    /// translates well-known <see cref="RpcException"/> statuses into domain exceptions:
    /// <see cref="StatusCode.ResourceExhausted"/> (gRPC equivalent of HTTP 429) into
    /// <see cref="LlmRateLimitException"/>, and connectivity failures
    /// (<see cref="StatusCode.Unavailable"/> / <see cref="StatusCode.DeadlineExceeded"/>)
    /// into <see cref="LlmUnavailableException"/> so callers return a 503 instead of an
    /// unhandled 500.
    /// </summary>
    private async Task<T> ExecuteAsync<T>(Func<CancellationToken, ValueTask<T>> grpcCall)
    {
        try
        {
            return await Pipeline.ExecuteAsync(grpcCall);
        }
        catch (RpcException ex) when (ex.StatusCode == StatusCode.ResourceExhausted)
        {
            throw new LlmRateLimitException(
                "The AI service has exceeded its quota. Please try again later.", ex);
        }
        catch (RpcException ex) when (ex.StatusCode is StatusCode.Unavailable or StatusCode.DeadlineExceeded)
        {
            throw new LlmUnavailableException(
                "The AI service is currently unreachable. Please try again later.", ex);
        }
        catch (RpcException ex) when (ex.StatusCode == StatusCode.InvalidArgument)
        {
            // Guard / scope / validation rejection from llm-service. The status
            // detail is the assistant's own explanation — surface it verbatim
            // (US-AI-11 llm_invalid_request).
            throw new LlmInvalidRequestException(ex.Status.Detail, ex);
        }
        catch (RpcException ex) when (ex.StatusCode == StatusCode.Internal)
        {
            // The service ran but hit an unexpected error (provider/SDK failure or a
            // bug). Truncated or unparseable edits never land here — the chat chains
            // answer those in-band — and this covers every operation, including the
            // read-only global assistant, so the message names no edit or cause.
            throw new LlmFailedException(
                "The assistant ran into an unexpected problem and couldn't respond. Please try again.", ex);
        }
    }

    public async Task<LlmGenerateResponse> GenerateAsync(LlmGenerateRequest request)
    {
        var reply = await ExecuteAsync(async _ =>
            await grpcClient.GenerateAsync(new GenerateRequest
            {
                Profile = ToProto(request.Profile),
                Message = request.Message ?? string.Empty,
                GlobalPreferences = request.GlobalPreferences ?? string.Empty,
            }, BuildCallOptions(null)));

        return new LlmGenerateResponse(FromProto(reply.Document), MapUsage(reply.Usage));
    }

    public async Task<LlmExtractResponse> ExtractAsync(LlmExtractRequest request)
    {
        var reply = await ExecuteAsync(async _ =>
            await grpcClient.ExtractProfileAsync(new ExtractProfileRequest
            {
                CvText = request.CvText,
            }, BuildCallOptions(null)));

        return new LlmExtractResponse(FromProto(reply.Document), MapUsage(reply.Usage), reply.ProfileName);
    }

    public async Task<LlmChatResponse> ChatAsync(LlmChatRequest request)
    {
        var grpcRequest = new CvApi.Grpc.ChatRequest
        {
            Profile = ToProto(request.Profile),
            Message = request.Message,
        };
        grpcRequest.History.AddRange(request.History.Select(h => new CvApi.Grpc.ChatMessage
        {
            Role = h.Role,
            Content = h.Content,
        }));
        // US-AI-13 — pass the user's other saved profiles for on-demand tool reads.
        if (request.OtherProfiles is not null)
        {
            grpcRequest.OtherProfiles.AddRange(request.OtherProfiles.Select(p => new CvApi.Grpc.OtherProfile
            {
                Id = p.Id,
                Name = p.Name,
                Document = ToProto(p.Document),
            }));
        }

        var reply = await ExecuteAsync(async _ =>
            await grpcClient.ChatAsync(grpcRequest, BuildCallOptions(request.SessionId)));

        LlmChatProposal? proposal = null;
        if (!string.IsNullOrEmpty(reply.Proposal?.Type))
        {
            proposal = new LlmChatProposal(
                reply.Proposal.Type,
                reply.Proposal.Description,
                reply.Proposal.PatchJson
            );
        }

        return new LlmChatResponse(reply.Reply, proposal, MapUsage(reply.Usage));
    }

    public async Task<LlmUserChatResponse> UserChatAsync(LlmUserChatRequest request)
    {
        var grpcRequest = new CvApi.Grpc.UserChatRequest
        {
            Message = request.Message,
            GlobalPreferences = request.GlobalPreferences ?? string.Empty,
        };
        grpcRequest.Profiles.AddRange(request.Profiles.Select(p => new CvApi.Grpc.ProfileSummary
        {
            Name = p.Name,
            Title = p.Title,
            Overview = p.Overview,
            Skills = { p.Skills },
        }));
        grpcRequest.History.AddRange(request.History.Select(h => new CvApi.Grpc.ChatMessage
        {
            Role = h.Role,
            Content = h.Content,
        }));

        var reply = await ExecuteAsync(async _ =>
            await grpcClient.UserChatAsync(grpcRequest, BuildCallOptions(request.SessionId)));

        return new LlmUserChatResponse(
            reply.Reply,
            string.IsNullOrEmpty(reply.PreferencesUpdate) ? null : reply.PreferencesUpdate,
            MapUsage(reply.Usage)
        );
    }

    public async Task<LlmJobChatResponse> JobChatAsync(LlmJobChatRequest request)
    {
        var grpcRequest = new CvApi.Grpc.JobChatRequest
        {
            JobTitle = request.JobTitle,
            JobDescription = request.JobDescription,
            FieldContext = request.FieldContext,
            Message = request.Message,
        };
        grpcRequest.Profiles.AddRange(request.Profiles.Select(p => new CvApi.Grpc.ProfileSummary
        {
            Name = p.Name,
            Title = p.Title,
            Overview = p.Overview,
            Skills = { p.Skills },
        }));
        grpcRequest.History.AddRange(request.History.Select(h => new CvApi.Grpc.ChatMessage
        {
            Role = h.Role,
            Content = h.Content,
        }));

        var reply = await ExecuteAsync(async _ =>
            await grpcClient.JobChatAsync(grpcRequest, BuildCallOptions(request.SessionId)));

        LlmChatProposal? proposal = null;
        if (!string.IsNullOrEmpty(reply.Proposal?.Type))
        {
            proposal = new LlmChatProposal(
                reply.Proposal.Type,
                reply.Proposal.Description,
                reply.Proposal.PatchJson,
                reply.Proposal.Text
            );
        }

        return new LlmJobChatResponse(reply.Reply, proposal, MapUsage(reply.Usage));
    }

    public async Task<LlmCoverLetterResponse> GenerateCoverLetterAsync(LlmCoverLetterRequest request)
    {
        var grpcRequest = new CvApi.Grpc.CoverLetterRequest
        {
            JobTitle = request.JobTitle,
            JobDescription = request.JobDescription,
            FieldContext = request.FieldContext,
            GlobalPreferences = request.GlobalPreferences ?? string.Empty,
        };
        grpcRequest.Profiles.AddRange(request.Profiles.Select(ToProto));

        var reply = await ExecuteAsync(async _ =>
            await grpcClient.GenerateCoverLetterAsync(grpcRequest, BuildCallOptions(null)));

        return new LlmCoverLetterResponse(
            reply.Text,
            Guid.TryParse(reply.SelectedProfileId, out var id) ? id : Guid.Empty,
            MapUsage(reply.Usage)
        );
    }

    public async Task<LlmSelectBestProfileResponse> SelectBestProfileAsync(LlmSelectBestProfileRequest request)
    {
        var grpcRequest = new CvApi.Grpc.SelectBestProfileRequest
        {
            JobDescription = request.JobDescription,
        };
        grpcRequest.Profiles.AddRange(request.Profiles.Select(ToProto));

        var reply = await ExecuteAsync(async _ =>
            await grpcClient.SelectBestProfileAsync(grpcRequest, BuildCallOptions(null)));

        return new LlmSelectBestProfileResponse(
            Guid.TryParse(reply.ProfileId, out var id) ? id : Guid.Empty
        );
    }

    private static ProfileDocumentProto ToProto(LlmProfileWithId p)
    {
        var proto = ToProto(p.Document);
        proto.Id = p.Id;
        return proto;
    }

    private static ProfileDocumentProto ToProto(ProfileDocument doc)
    {
        return new ProfileDocumentProto
        {
            Header = new ProfileHeaderProto
            {
                FullName = doc.Header.FullName,
                Title = doc.Header.Title,
                Email = doc.Header.Email,
                Phone = doc.Header.Phone,
                Location = doc.Header.Location,
            },
            Body = NodeToProto(doc.Body),
        };
    }

    private static ProfileNode NodeToProto(BlockNode node)
    {
        var proto = new ProfileNode { Type = node.Type, Id = node.Id };
        foreach (var (key, value) in node.Attrs)
            proto.Attrs[key] = value ?? string.Empty;
        proto.Children.AddRange(node.Children.Select(NodeToProto));
        return proto;
    }

    private static ProfileDocument FromProto(ProfileDocumentProto? proto)
    {
        if (proto is null) return ProfileDocument.Empty();
        return new ProfileDocument
        {
            Header = new ProfileHeader
            {
                FullName = proto.Header?.FullName ?? string.Empty,
                Title = proto.Header?.Title ?? string.Empty,
                Email = proto.Header?.Email ?? string.Empty,
                Phone = proto.Header?.Phone ?? string.Empty,
                Location = proto.Header?.Location ?? string.Empty,
            },
            Body = proto.Body is null ? BlockNode.Root() : NodeFromProto(proto.Body),
        };
    }

    private static BlockNode NodeFromProto(ProfileNode proto)
    {
        return new BlockNode
        {
            Type = proto.Type,
            Id = proto.Id,
            Attrs = new Dictionary<string, string>(proto.Attrs),
            Children = proto.Children.Select(NodeFromProto).ToList(),
        };
    }
}

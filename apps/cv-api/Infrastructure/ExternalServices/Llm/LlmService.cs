using System.Diagnostics;
using System.Security.Claims;
using CvApi.Domain.Entities;
using CvApi.Grpc;
using CvApi.Infrastructure.Services;
using Grpc.Core;
using Microsoft.AspNetCore.Http;
using Polly;
using Polly.Registry;

namespace CvApi.Infrastructure.ExternalServices.Llm;

public class LlmService(
    CvApi.Grpc.LlmService.LlmServiceClient grpcClient,
    TraceContext trace,
    IHttpContextAccessor httpContextAccessor,
    ResiliencePipelineProvider<string> pipelineProvider) : ILlmService
{
    /// <summary>Key used to register the Polly resilience pipeline in DI.</summary>
    public const string ResiliencePipelineKey = "llm-grpc";

    private static readonly TimeSpan CallDeadline = TimeSpan.FromSeconds(60);

    private ResiliencePipeline Pipeline => pipelineProvider.GetPipeline(ResiliencePipelineKey);

    /// <summary>
    /// Per-call options carrying the deadline plus Langfuse trace-context headers
    /// (ADR-0010): the cv-api request correlation id and the authenticated user id,
    /// so the llm-service trace links back to this request's <see cref="RequestSpan"/> rows.
    /// </summary>
    private CallOptions DefaultCallOptions
    {
        get
        {
            var metadata = new Metadata { { "x-trace-id", trace.TraceId.ToString() } };
            var userId = httpContextAccessor.HttpContext?.User?.FindFirstValue(ClaimTypes.NameIdentifier);
            if (!string.IsNullOrEmpty(userId))
                metadata.Add("x-user-id", userId);
            return new CallOptions(headers: metadata, deadline: DateTime.UtcNow.Add(CallDeadline));
        }
    }


    private static LlmTokenUsage MapUsage(CvApi.Grpc.UsageMetadata? usage) =>
        usage is null
            ? LlmTokenUsage.Empty
            : new LlmTokenUsage(usage.PromptTokens, usage.CompletionTokens, usage.ModelName);

    private void AddSpan(string operation, bool isError, long durationMs, DateTime startedAt) =>
        trace.PendingSpans.Add(new RequestSpan
        {
            TraceId = trace.TraceId,
            Service = "cv-api",
            SpanKind = "grpc",
            Operation = operation,
            IsError = isError,
            DurationMs = (int)durationMs,
            StartedAt = startedAt,
        });

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
    }

    public async Task<LlmGenerateResponse> GenerateAsync(LlmGenerateRequest request)
    {
        var sw = Stopwatch.StartNew();
        var startedAt = DateTime.UtcNow;
        try
        {
            var reply = await ExecuteAsync(async _ =>
                await grpcClient.GenerateAsync(new GenerateRequest
                {
                    Profile = ToProto(request.Profile),
                    Message = request.Message ?? string.Empty,
                    GlobalPreferences = request.GlobalPreferences ?? string.Empty,
                }, DefaultCallOptions));

            AddSpan("LlmService/Generate", false, sw.ElapsedMilliseconds, startedAt);

            return new LlmGenerateResponse(FromProto(reply.Document), MapUsage(reply.Usage));
        }
        catch
        {
            AddSpan("LlmService/Generate", true, sw.ElapsedMilliseconds, startedAt);
            throw;
        }
    }

    public async Task<LlmExtractResponse> ExtractAsync(LlmExtractRequest request)
    {
        var sw = Stopwatch.StartNew();
        var startedAt = DateTime.UtcNow;
        try
        {
            var reply = await ExecuteAsync(async _ =>
                await grpcClient.ExtractProfileAsync(new ExtractProfileRequest
                {
                    CvText = request.CvText,
                }, DefaultCallOptions));

            AddSpan("LlmService/ExtractProfile", false, sw.ElapsedMilliseconds, startedAt);

            return new LlmExtractResponse(FromProto(reply.Document), MapUsage(reply.Usage));
        }
        catch
        {
            AddSpan("LlmService/ExtractProfile", true, sw.ElapsedMilliseconds, startedAt);
            throw;
        }
    }

    public async Task<LlmChatResponse> ChatAsync(LlmChatRequest request)
    {
        var sw = Stopwatch.StartNew();
        var startedAt = DateTime.UtcNow;
        try
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

            var reply = await ExecuteAsync(async _ =>
                await grpcClient.ChatAsync(grpcRequest, DefaultCallOptions));

            AddSpan("LlmService/Chat", false, sw.ElapsedMilliseconds, startedAt);

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
        catch
        {
            AddSpan("LlmService/Chat", true, sw.ElapsedMilliseconds, startedAt);
            throw;
        }
    }

    public async Task<LlmUserChatResponse> UserChatAsync(LlmUserChatRequest request)
    {
        var sw = Stopwatch.StartNew();
        var startedAt = DateTime.UtcNow;
        try
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
                await grpcClient.UserChatAsync(grpcRequest, DefaultCallOptions));

            AddSpan("LlmService/UserChat", false, sw.ElapsedMilliseconds, startedAt);

            return new LlmUserChatResponse(
                reply.Reply,
                string.IsNullOrEmpty(reply.PreferencesUpdate) ? null : reply.PreferencesUpdate,
                MapUsage(reply.Usage)
            );
        }
        catch
        {
            AddSpan("LlmService/UserChat", true, sw.ElapsedMilliseconds, startedAt);
            throw;
        }
    }

    public async Task<LlmCoverLetterResponse> GenerateCoverLetterAsync(LlmCoverLetterRequest request)
    {
        var sw = Stopwatch.StartNew();
        var startedAt = DateTime.UtcNow;
        try
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
                await grpcClient.GenerateCoverLetterAsync(grpcRequest, DefaultCallOptions));

            AddSpan("LlmService/GenerateCoverLetter", false, sw.ElapsedMilliseconds, startedAt);

            return new LlmCoverLetterResponse(
                reply.Text,
                Guid.TryParse(reply.SelectedProfileId, out var id) ? id : Guid.Empty,
                MapUsage(reply.Usage)
            );
        }
        catch
        {
            AddSpan("LlmService/GenerateCoverLetter", true, sw.ElapsedMilliseconds, startedAt);
            throw;
        }
    }

    public async Task<LlmSelectBestProfileResponse> SelectBestProfileAsync(LlmSelectBestProfileRequest request)
    {
        var sw = Stopwatch.StartNew();
        var startedAt = DateTime.UtcNow;
        try
        {
            var grpcRequest = new CvApi.Grpc.SelectBestProfileRequest
            {
                JobDescription = request.JobDescription,
            };
            grpcRequest.Profiles.AddRange(request.Profiles.Select(ToProto));

            var reply = await ExecuteAsync(async _ =>
                await grpcClient.SelectBestProfileAsync(grpcRequest, DefaultCallOptions));

            AddSpan("LlmService/SelectBestProfile", false, sw.ElapsedMilliseconds, startedAt);

            return new LlmSelectBestProfileResponse(
                Guid.TryParse(reply.ProfileId, out var id) ? id : Guid.Empty
            );
        }
        catch
        {
            AddSpan("LlmService/SelectBestProfile", true, sw.ElapsedMilliseconds, startedAt);
            throw;
        }
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

using CvApi.Domain.Entities;
using CvApi.Grpc;
using CvApi.Infrastructure.ExternalServices.Llm;
using Grpc.Core;
using Microsoft.AspNetCore.Http;
using Moq;
using Polly;
using Polly.Registry;
using LlmService = CvApi.Infrastructure.ExternalServices.Llm.LlmService;

namespace CvApi.Tests;

// US-AI-16 (F-AI-16.4, F-AI-16.6) — cv-api forwards the chat widget's per-mount
// sessionId to llm-service as the gRPC metadata header `x-session-id` (alongside
// the existing x-trace-id / x-user-id), so all messages in one conversation
// group under a single Langfuse Session. A null/empty SessionId adds no header.
public class LlmServiceSessionMetadataTests
{
    private const string SessionHeader = "x-session-id";

    private static AsyncUnaryCall<T> Completed<T>(T reply) => new(
        Task.FromResult(reply),
        Task.FromResult(new Metadata()),
        () => Status.DefaultSuccess,
        () => new Metadata(),
        () => { });

    private static Mock<ResiliencePipelineProvider<string>> PipelineProvider()
    {
        var provider = new Mock<ResiliencePipelineProvider<string>>();
        provider
            .Setup(p => p.GetPipeline(LlmService.ResiliencePipelineKey))
            .Returns(ResiliencePipeline.Empty);
        return provider;
    }

    private static ProfileDocument EmptyProfile() => new()
    {
        Header = new ProfileHeader { FullName = "", Title = "", Email = "", Phone = "", Location = "" },
        Body = BlockNode.Root(),
    };

    // -- ChatAsync (edit mode) -------------------------------------------------

    [Fact]
    public async Task ChatAsync_WithSessionId_AddsSessionIdHeader()
    {
        CallOptions captured = default;
        var client = new Mock<CvApi.Grpc.LlmService.LlmServiceClient>();
        client
            .Setup(c => c.ChatAsync(It.IsAny<ChatRequest>(), It.IsAny<CallOptions>()))
            .Callback<ChatRequest, CallOptions>((_, opts) => captured = opts)
            .Returns(Completed(new ChatResponse { Reply = "ok" }));

        var svc = new LlmService(client.Object, new HttpContextAccessor(), PipelineProvider().Object);

        await svc.ChatAsync(new LlmChatRequest(
            EmptyProfile(), "hi", new List<LlmChatMessage>()) { SessionId = "sess-123" });

        Assert.Equal("sess-123", captured.Headers?.GetValue(SessionHeader));
    }

    [Fact]
    public async Task ChatAsync_WithNullSessionId_AddsNoSessionIdHeader()
    {
        CallOptions captured = default;
        var client = new Mock<CvApi.Grpc.LlmService.LlmServiceClient>();
        client
            .Setup(c => c.ChatAsync(It.IsAny<ChatRequest>(), It.IsAny<CallOptions>()))
            .Callback<ChatRequest, CallOptions>((_, opts) => captured = opts)
            .Returns(Completed(new ChatResponse { Reply = "ok" }));

        var svc = new LlmService(client.Object, new HttpContextAccessor(), PipelineProvider().Object);

        await svc.ChatAsync(new LlmChatRequest(
            EmptyProfile(), "hi", new List<LlmChatMessage>()));

        Assert.Null(captured.Headers?.GetValue(SessionHeader));
    }

    // -- UserChatAsync (global assistant) -------------------------------------

    [Fact]
    public async Task UserChatAsync_WithSessionId_AddsSessionIdHeader()
    {
        CallOptions captured = default;
        var client = new Mock<CvApi.Grpc.LlmService.LlmServiceClient>();
        client
            .Setup(c => c.UserChatAsync(It.IsAny<UserChatRequest>(), It.IsAny<CallOptions>()))
            .Callback<UserChatRequest, CallOptions>((_, opts) => captured = opts)
            .Returns(Completed(new UserChatResponse { Reply = "ok" }));

        var svc = new LlmService(client.Object, new HttpContextAccessor(), PipelineProvider().Object);

        await svc.UserChatAsync(new LlmUserChatRequest(
            new List<LlmProfileSummary>(), "hi", new List<LlmChatMessage>()) { SessionId = "sess-user" });

        Assert.Equal("sess-user", captured.Headers?.GetValue(SessionHeader));
    }

    [Fact]
    public async Task UserChatAsync_WithNullSessionId_AddsNoSessionIdHeader()
    {
        CallOptions captured = default;
        var client = new Mock<CvApi.Grpc.LlmService.LlmServiceClient>();
        client
            .Setup(c => c.UserChatAsync(It.IsAny<UserChatRequest>(), It.IsAny<CallOptions>()))
            .Callback<UserChatRequest, CallOptions>((_, opts) => captured = opts)
            .Returns(Completed(new UserChatResponse { Reply = "ok" }));

        var svc = new LlmService(client.Object, new HttpContextAccessor(), PipelineProvider().Object);

        await svc.UserChatAsync(new LlmUserChatRequest(
            new List<LlmProfileSummary>(), "hi", new List<LlmChatMessage>()));

        Assert.Null(captured.Headers?.GetValue(SessionHeader));
    }

    // -- JobChatAsync (side-panel) --------------------------------------------

    [Fact]
    public async Task JobChatAsync_WithSessionId_AddsSessionIdHeader()
    {
        CallOptions captured = default;
        var client = new Mock<CvApi.Grpc.LlmService.LlmServiceClient>();
        client
            .Setup(c => c.JobChatAsync(It.IsAny<JobChatRequest>(), It.IsAny<CallOptions>()))
            .Callback<JobChatRequest, CallOptions>((_, opts) => captured = opts)
            .Returns(Completed(new JobChatResponse { Reply = "ok" }));

        var svc = new LlmService(client.Object, new HttpContextAccessor(), PipelineProvider().Object);

        await svc.JobChatAsync(new LlmJobChatRequest(
            new List<LlmProfileSummary>(), "Engineer", "desc", "cover letter", "hi",
            new List<LlmChatMessage>()) { SessionId = "sess-job" });

        Assert.Equal("sess-job", captured.Headers?.GetValue(SessionHeader));
    }

    [Fact]
    public async Task JobChatAsync_WithNullSessionId_AddsNoSessionIdHeader()
    {
        CallOptions captured = default;
        var client = new Mock<CvApi.Grpc.LlmService.LlmServiceClient>();
        client
            .Setup(c => c.JobChatAsync(It.IsAny<JobChatRequest>(), It.IsAny<CallOptions>()))
            .Callback<JobChatRequest, CallOptions>((_, opts) => captured = opts)
            .Returns(Completed(new JobChatResponse { Reply = "ok" }));

        var svc = new LlmService(client.Object, new HttpContextAccessor(), PipelineProvider().Object);

        await svc.JobChatAsync(new LlmJobChatRequest(
            new List<LlmProfileSummary>(), "Engineer", "desc", "cover letter", "hi",
            new List<LlmChatMessage>()));

        Assert.Null(captured.Headers?.GetValue(SessionHeader));
    }
}

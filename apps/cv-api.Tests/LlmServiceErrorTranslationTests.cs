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

// US-AI-11 / F-AI-11.3-11.5 — LlmService.ExecuteAsync must translate the gRPC
// statuses llm-service emits into distinct domain exceptions, so the chat error
// handlers can map each to its own { code, message }. Internal means llm-service
// hit an unexpected error (truncated / unparseable edits are answered in-band
// by the chat chains, never as Internal), so its message is operation-neutral.
public class LlmServiceErrorTranslationTests
{
    private static AsyncUnaryCall<T> Faulted<T>(RpcException ex) => new(
        Task.FromException<T>(ex),
        Task.FromResult(new Metadata()),
        () => Status.DefaultSuccess,
        () => new Metadata(),
        () => { });

    private static LlmService BuildServiceThatThrows(StatusCode status, string detail)
    {
        var client = new Mock<CvApi.Grpc.LlmService.LlmServiceClient>();
        client
            .Setup(c => c.ChatAsync(It.IsAny<ChatRequest>(), It.IsAny<CallOptions>()))
            .Returns(Faulted<ChatResponse>(new RpcException(new Status(status, detail))));
        client
            .Setup(c => c.UserChatAsync(It.IsAny<UserChatRequest>(), It.IsAny<CallOptions>()))
            .Returns(Faulted<UserChatResponse>(new RpcException(new Status(status, detail))));

        var provider = new Mock<ResiliencePipelineProvider<string>>();
        provider
            .Setup(p => p.GetPipeline(LlmService.ResiliencePipelineKey))
            .Returns(ResiliencePipeline.Empty);

        return new LlmService(client.Object, new HttpContextAccessor(), provider.Object);
    }

    private static LlmChatRequest Request() => new(
        new ProfileDocument
        {
            Header = new ProfileHeader { FullName = "", Title = "", Email = "", Phone = "", Location = "" },
            Body = BlockNode.Root(),
        },
        "turn my skills list into chips",
        new List<LlmChatMessage>());

    [Fact]
    public async Task Internal_Becomes_LlmFailedException()
    {
        var svc = BuildServiceThatThrows(StatusCode.Internal, "AsyncMessages.create() got an unexpected keyword argument 'temperature'");
        await Assert.ThrowsAsync<LlmFailedException>(() => svc.ChatAsync(Request()));
    }

    [Fact]
    public async Task Internal_On_GlobalAssistant_Has_OperationNeutral_Message()
    {
        // The read-only global assistant has no document, so the message must not
        // talk about edits or response length — and must not leak the raw detail.
        var svc = BuildServiceThatThrows(StatusCode.Internal, "AsyncMessages.create() got an unexpected keyword argument 'temperature'");
        var ex = await Assert.ThrowsAsync<LlmFailedException>(() => svc.UserChatAsync(
            new LlmUserChatRequest(new List<LlmProfileSummary>(), "hello", new List<LlmChatMessage>())));

        Assert.Equal("The assistant ran into an unexpected problem and couldn't respond. Please try again.", ex.Message);
        Assert.DoesNotContain("edit", ex.Message, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("too long", ex.Message, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("temperature", ex.Message);
    }

    [Fact]
    public async Task InvalidArgument_Becomes_LlmInvalidRequestException_CarryingDetail()
    {
        var svc = BuildServiceThatThrows(StatusCode.InvalidArgument, "Message exceeds the 4000 character limit.");
        var ex = await Assert.ThrowsAsync<LlmInvalidRequestException>(() => svc.ChatAsync(Request()));
        Assert.Contains("4000 character", ex.Message);
    }

    [Fact]
    public async Task ResourceExhausted_StillBecomes_LlmRateLimitException()
    {
        var svc = BuildServiceThatThrows(StatusCode.ResourceExhausted, "quota");
        await Assert.ThrowsAsync<LlmRateLimitException>(() => svc.ChatAsync(Request()));
    }

    [Fact]
    public async Task Unavailable_StillBecomes_LlmUnavailableException()
    {
        var svc = BuildServiceThatThrows(StatusCode.Unavailable, "connection refused");
        await Assert.ThrowsAsync<LlmUnavailableException>(() => svc.ChatAsync(Request()));
    }
}

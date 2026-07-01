using System.Text.Json;
using CvApi.Infrastructure.ExternalServices.Llm;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Http;

namespace CvApi.Tests;

// US-AI-11 / §11 — each LLM failure is classified into a stable { code, message }
// body with the right HTTP status, so the chat widget can show a specific reason
// instead of a generic "something went wrong".
public class ChatErrorHandlerTests
{
    private static async Task<(int status, string code, string message)> Handle(
        IExceptionHandler handler, Exception ex)
    {
        var ctx = new DefaultHttpContext();
        ctx.Response.Body = new MemoryStream();

        var handled = await handler.TryHandleAsync(ctx, ex, CancellationToken.None);
        Assert.True(handled, "handler should claim its own exception type");

        ctx.Response.Body.Position = 0;
        using var doc = await JsonDocument.ParseAsync(ctx.Response.Body);
        return (
            ctx.Response.StatusCode,
            doc.RootElement.GetProperty("code").GetString()!,
            doc.RootElement.GetProperty("message").GetString()!);
    }

    [Fact]
    public async Task EditFailed_Maps_To_502_LlmEditFailed_WithMessage()
    {
        var (status, code, message) = await Handle(
            new LlmEditFailedExceptionHandler(),
            new LlmEditFailedException("I couldn't produce a valid edit for that."));

        Assert.Equal(StatusCodes.Status502BadGateway, status);
        Assert.Equal("llm_edit_failed", code);
        Assert.False(string.IsNullOrWhiteSpace(message));
    }

    [Fact]
    public async Task InvalidRequest_Maps_To_422_AndSurfacesAssistantDetail()
    {
        // F-AI-11.4 — message carries the gRPC InvalidArgument detail (the
        // assistant's own explanation), not a canned string.
        var (status, code, message) = await Handle(
            new LlmInvalidRequestExceptionHandler(),
            new LlmInvalidRequestException("Message exceeds the 4000 character limit."));

        Assert.Equal(StatusCodes.Status422UnprocessableEntity, status);
        Assert.Equal("llm_invalid_request", code);
        Assert.Equal("Message exceeds the 4000 character limit.", message);
    }

    [Fact]
    public async Task RateLimited_Maps_To_429_LlmRateLimited()
    {
        var (status, code, _) = await Handle(
            new LlmRateLimitExceptionHandler(),
            new LlmRateLimitException("The AI service has exceeded its quota."));

        Assert.Equal(StatusCodes.Status429TooManyRequests, status);
        Assert.Equal("llm_rate_limited", code);
    }

    [Fact]
    public async Task Unavailable_Maps_To_503_LlmUnavailable()
    {
        var (status, code, _) = await Handle(
            new LlmUnavailableExceptionHandler(),
            new LlmUnavailableException("The AI service is currently unreachable."));

        Assert.Equal(StatusCodes.Status503ServiceUnavailable, status);
        Assert.Equal("llm_unavailable", code);
    }

    [Fact]
    public async Task Handler_Ignores_UnrelatedException()
    {
        var ctx = new DefaultHttpContext();
        var handled = await new LlmEditFailedExceptionHandler()
            .TryHandleAsync(ctx, new InvalidOperationException("nope"), CancellationToken.None);

        Assert.False(handled);
    }
}

using Microsoft.AspNetCore.Diagnostics;

namespace CvApi.Infrastructure.ExternalServices.Llm;

// US-AI-11 / §11 — map each LLM failure to a stable { code, message } body with
// the right HTTP status, mirroring UsageLimitExceptionHandler (§9). The chat
// widget renders `message` verbatim, so the user sees a specific reason instead
// of a generic "something went wrong". Registered in Program.cs.

/// <summary>llm-service produced an unusable result (gRPC Internal) → 502 <c>llm_edit_failed</c>.</summary>
public sealed class LlmEditFailedExceptionHandler : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(
        HttpContext httpContext, Exception exception, CancellationToken cancellationToken)
    {
        if (exception is not LlmEditFailedException ex)
            return false;

        httpContext.Response.StatusCode = StatusCodes.Status502BadGateway;
        await httpContext.Response.WriteAsJsonAsync(
            new { code = "llm_edit_failed", message = ex.Message }, cancellationToken);
        return true;
    }
}

/// <summary>Request rejected by llm-service (gRPC InvalidArgument) → 422 <c>llm_invalid_request</c>.</summary>
public sealed class LlmInvalidRequestExceptionHandler : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(
        HttpContext httpContext, Exception exception, CancellationToken cancellationToken)
    {
        if (exception is not LlmInvalidRequestException ex)
            return false;

        httpContext.Response.StatusCode = StatusCodes.Status422UnprocessableEntity;
        await httpContext.Response.WriteAsJsonAsync(
            new { code = "llm_invalid_request", message = ex.Message }, cancellationToken);
        return true;
    }
}

/// <summary>Provider quota exhausted (gRPC ResourceExhausted) → 429 <c>llm_rate_limited</c>.</summary>
public sealed class LlmRateLimitExceptionHandler : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(
        HttpContext httpContext, Exception exception, CancellationToken cancellationToken)
    {
        if (exception is not LlmRateLimitException ex)
            return false;

        httpContext.Response.StatusCode = StatusCodes.Status429TooManyRequests;
        await httpContext.Response.WriteAsJsonAsync(
            new { code = "llm_rate_limited", message = ex.Message }, cancellationToken);
        return true;
    }
}

/// <summary>llm-service unreachable/timed out (gRPC Unavailable/DeadlineExceeded) → 503 <c>llm_unavailable</c>.</summary>
public sealed class LlmUnavailableExceptionHandler : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(
        HttpContext httpContext, Exception exception, CancellationToken cancellationToken)
    {
        if (exception is not LlmUnavailableException ex)
            return false;

        httpContext.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
        await httpContext.Response.WriteAsJsonAsync(
            new { code = "llm_unavailable", message = ex.Message }, cancellationToken);
        return true;
    }
}

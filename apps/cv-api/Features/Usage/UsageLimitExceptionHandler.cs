using Microsoft.AspNetCore.Diagnostics;

namespace CvApi.Features.Usage;

/// <summary>
/// Maps <see cref="UsageLimitExceededException"/> to HTTP 402 with a stable,
/// machine-readable code so the frontend can show a distinct "spending limit
/// reached" message instead of a generic AI-failure (US-AI-7, F-AI-9.4).
/// </summary>
public sealed class UsageLimitExceptionHandler : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(
        HttpContext httpContext, Exception exception, CancellationToken cancellationToken)
    {
        if (exception is not UsageLimitExceededException limitEx)
            return false;

        httpContext.Response.StatusCode = StatusCodes.Status402PaymentRequired;
        await httpContext.Response.WriteAsJsonAsync(new
        {
            code = "usage_limit_exceeded",
            message = limitEx.Message,
            limitUsd = limitEx.LimitUsd,
        }, cancellationToken);

        return true;
    }
}

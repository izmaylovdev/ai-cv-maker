using System.Diagnostics;
using CvApi.Domain.Entities;
using CvApi.Infrastructure.Persistence;
using CvApi.Infrastructure.Services;

namespace CvApi.Infrastructure.Middleware;

public class RequestTracingMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext context, TraceContext trace, AppDbContext db)
    {
        var sw = Stopwatch.StartNew();
        var startedAt = DateTime.UtcNow;
        try
        {
            await next(context);
        }
        finally
        {
            sw.Stop();
            var httpSpan = new RequestSpan
            {
                TraceId = trace.TraceId,
                Service = "cv-api",
                SpanKind = "http",
                Operation = $"{context.Request.Method} {context.Request.Path}",
                StatusCode = context.Response.StatusCode,
                IsError = context.Response.StatusCode >= 500,
                DurationMs = (int)sw.ElapsedMilliseconds,
                StartedAt = startedAt,
            };

            try
            {
                db.RequestSpans.AddRange([httpSpan, .. trace.PendingSpans]);
                await db.SaveChangesAsync();
            }
            catch
            {
                // span writes are best-effort and must not affect the response
            }
        }
    }
}

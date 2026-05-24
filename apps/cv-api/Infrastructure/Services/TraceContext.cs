using CvApi.Domain.Entities;

namespace CvApi.Infrastructure.Services;

public class TraceContext
{
    public Guid TraceId { get; } = Guid.NewGuid();
    public List<RequestSpan> PendingSpans { get; } = [];
}

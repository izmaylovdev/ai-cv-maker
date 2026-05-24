namespace CvApi.Domain.Entities;

public class RequestSpan
{
    public long Id { get; set; }
    public Guid TraceId { get; set; }
    public string Service { get; set; } = string.Empty;
    public string SpanKind { get; set; } = string.Empty;
    public string Operation { get; set; } = string.Empty;
    public int? StatusCode { get; set; }
    public bool IsError { get; set; }
    public int DurationMs { get; set; }
    public DateTime StartedAt { get; set; }
}

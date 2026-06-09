namespace CvApi.Infrastructure.ExternalServices.Llm;

/// <summary>
/// Thrown when the LLM service returns a ResourceExhausted (gRPC) / 429 status,
/// indicating quota or rate-limit exhaustion.
/// </summary>
public class LlmRateLimitException : Exception
{
    public LlmRateLimitException(string message, Exception? inner = null)
        : base(message, inner) { }
}

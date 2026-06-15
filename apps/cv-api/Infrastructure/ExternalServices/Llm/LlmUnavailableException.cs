namespace CvApi.Infrastructure.ExternalServices.Llm;

/// <summary>
/// Thrown when the LLM service cannot be reached or did not respond in time —
/// the gRPC channel reported <c>Unavailable</c> (connection refused / DNS /
/// transient outage) or <c>DeadlineExceeded</c>. Distinct from
/// <see cref="LlmRateLimitException"/>, which signals quota exhaustion.
/// </summary>
public class LlmUnavailableException : Exception
{
    public LlmUnavailableException(string message, Exception? inner = null)
        : base(message, inner) { }
}

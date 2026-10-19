namespace CvApi.Infrastructure.ExternalServices.Llm;

/// <summary>
/// Thrown when the LLM service reported a gRPC <c>Internal</c> status — it was
/// reached but hit an unexpected error (a provider/SDK failure or a bug). Distinct
/// from <see cref="LlmUnavailableException"/> (connectivity) and
/// <see cref="LlmRateLimitException"/> (quota). Truncated or unparseable edits are
/// not this: the chat chains answer those in-band with a normal reply. Surfaced
/// to the user as <c>llm_failed</c> with an operation-neutral message, since every
/// LLM operation (including the read-only global assistant) can raise it.
/// </summary>
public class LlmFailedException : Exception
{
    public LlmFailedException(string message, Exception? inner = null)
        : base(message, inner) { }
}

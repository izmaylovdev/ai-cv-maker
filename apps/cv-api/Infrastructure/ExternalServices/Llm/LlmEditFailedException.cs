namespace CvApi.Infrastructure.ExternalServices.Llm;

/// <summary>
/// Thrown when the LLM service reported a gRPC <c>Internal</c> status — typically
/// the assistant produced a response the service could not turn into a valid edit
/// (e.g. JSON truncated because the model hit its output-token cap). Distinct from
/// <see cref="LlmUnavailableException"/> (connectivity) and
/// <see cref="LlmRateLimitException"/> (quota): the service was reached and ran,
/// but could not produce a usable result. Surfaced to the user as US-AI-11
/// <c>llm_edit_failed</c> so they can retry with a smaller / more specific edit.
/// </summary>
public class LlmEditFailedException : Exception
{
    public LlmEditFailedException(string message, Exception? inner = null)
        : base(message, inner) { }
}

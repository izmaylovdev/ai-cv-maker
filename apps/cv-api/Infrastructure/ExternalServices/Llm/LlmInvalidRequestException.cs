namespace CvApi.Infrastructure.ExternalServices.Llm;

/// <summary>
/// Thrown when the LLM service rejected the request with a gRPC
/// <c>InvalidArgument</c> status — a guard, scope, or validation failure (e.g. the
/// message is too long, or the request is out of the assistant's scope). The
/// <see cref="Exception.Message"/> carries the gRPC status detail, i.e. the
/// assistant's own explanation, which is surfaced verbatim to the user
/// (US-AI-11 <c>llm_invalid_request</c>).
/// </summary>
public class LlmInvalidRequestException : Exception
{
    public LlmInvalidRequestException(string message, Exception? inner = null)
        : base(message, inner) { }
}

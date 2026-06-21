namespace CvApi.Features.JobProfiles;

/// <summary>
/// Thrown when a profile document's BlockNode body fails schema validation
/// (ADR-0014 §9.3). Mapped to HTTP 400 by the controller.
/// </summary>
public class InvalidProfileDocumentException(string reason)
    : Exception($"Invalid profile document: {reason}")
{
    public string Reason { get; } = reason;
}

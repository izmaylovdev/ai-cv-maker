using CvApi.Domain.Entities;

namespace CvApi.Infrastructure.ExternalServices.Pdf;

public interface IPdfService
{
    /// <summary>
    /// Renders the canonical ProfileDocument (ADR-0013) directly: header + its
    /// sections in document order, faithful to whatever the user authored. Used by
    /// the default/draft PDF paths and the stored generated-CV snapshot.
    /// </summary>
    byte[] GenerateFromDocument(ProfileDocument doc);
}

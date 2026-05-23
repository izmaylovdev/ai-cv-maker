using CvApi.Infrastructure.ExternalServices.Llm;

namespace CvApi.Infrastructure.ExternalServices.Pdf;

public interface IPdfService
{
    byte[] GenerateCv(LlmGenerateResponse cvData, string fullName, string title,
        string? location, string? email, string? phone, IList<string>? sectionOrder);
}

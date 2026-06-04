namespace CvApi.Features.CoverLetter;

public record GenerateCoverLetterRequest(
    string JobTitle,
    string JobDescription,
    string FieldContext,
    Guid? ProfileIdOverride
);

public record GenerateCoverLetterResponse(
    string Text,
    Guid SelectedProfileId,
    string SelectedProfileName
);

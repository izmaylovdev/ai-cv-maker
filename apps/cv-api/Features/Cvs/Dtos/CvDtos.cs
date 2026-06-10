namespace CvApi.Features.Cvs.Dtos;

public record CvListItemDto(Guid Id, DateTime CreatedAt, string? OptimizationNotes, string Title);
public record CreateCvRequest(string? OptimizationNotes);
public record GenerateAutoRequest(string JobDescription);
public record GenerateAutoResponse(Guid CvId, Guid ProfileId, string FullName);

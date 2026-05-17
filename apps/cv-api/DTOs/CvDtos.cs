namespace CvApi.DTOs;

public record CvListItemDto(
    Guid Id,
    DateTime CreatedAt,
    string? OptimizationNotes,
    string Title
);

public record CreateCvRequest(string? OptimizationNotes);

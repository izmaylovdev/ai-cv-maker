namespace CvApi.DTOs;

public record WorkExperienceDto(
    Guid? Id,
    string Company,
    string Role,
    DateOnly StartDate,
    DateOnly? EndDate,
    string Description
);

public record EducationDto(
    Guid? Id,
    string Institution,
    string Degree,
    string Field,
    int StartYear,
    int? EndYear
);

public record SkillDto(
    Guid? Id,
    string Name
);

public record ContactsDto(
    string? Email,
    string? Phone
);

public record ProfileDto(
    Guid Id,
    string FullName,
    string Title,
    string Overview,
    string? Location,
    ContactsDto? Contacts,
    List<WorkExperienceDto> WorkExperiences,
    List<EducationDto> Educations,
    List<SkillDto> Skills
);

public record UpdateProfileRequest(
    string FullName,
    string Title,
    string Overview,
    string? Location,
    ContactsDto? Contacts,
    List<WorkExperienceDto> WorkExperiences,
    List<EducationDto> Educations,
    List<SkillDto> Skills
);

public record OptimizeProfileRequest(string Message);

public record OptimizeWorkExperienceDto(
    string Company,
    string Role,
    string StartDate,
    string? EndDate,
    string Description
);

public record OptimizeSkillDto(string Name);

public record OptimizeProfileResponse(
    string Title,
    string Overview,
    List<OptimizeWorkExperienceDto> WorkExperiences,
    List<OptimizeSkillDto> Skills
);

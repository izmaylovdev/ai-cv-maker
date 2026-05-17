namespace CvApi.DTOs;

public record LlmProfileRequest(
    string FullName,
    string Title,
    string Overview,
    string? Location,
    List<WorkExperienceDto> WorkExperiences,
    List<EducationDto> Educations,
    List<SkillDto> Skills
);

public record LlmGenerateRequest(LlmProfileRequest Profile, string? Message = null);

public record LlmWorkExperience(
    string Company,
    string Role,
    string Period,
    string Description
);

public record LlmEducation(
    string Institution,
    string Degree,
    string Field,
    string Period
);

public record LlmGenerateResponse(
    string Summary,
    List<LlmWorkExperience> WorkExperiences,
    List<LlmEducation> Educations,
    List<string> Skills,
    List<string> Highlights
);

public record LlmOptimizeRequest(LlmProfileRequest Profile, string Message);

public record LlmOptimizeWorkExperience(
    string Company,
    string Role,
    string StartDate,
    string? EndDate,
    string Description
);

public record LlmOptimizeSkill(string Name);

public record LlmOptimizeResponse(
    string Title,
    string Overview,
    List<LlmOptimizeWorkExperience> WorkExperiences,
    List<LlmOptimizeSkill> Skills
);

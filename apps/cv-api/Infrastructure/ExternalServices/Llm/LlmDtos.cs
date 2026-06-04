namespace CvApi.Infrastructure.ExternalServices.Llm;

public record LlmWorkInput(Guid? Id, string Company, string Role, DateOnly StartDate, DateOnly? EndDate, string Description);
public record LlmEducationInput(Guid? Id, string Institution, string Degree, string Field, int StartYear, int? EndYear);
public record LlmSkillInput(Guid? Id, string Name);

public record LlmProfileRequest(
    string FullName,
    string Title,
    string Overview,
    string? Location,
    List<LlmWorkInput> WorkExperiences,
    List<LlmEducationInput> Educations,
    List<LlmSkillInput> Skills
);

public record LlmGenerateRequest(LlmProfileRequest Profile, string? Message = null);

public record LlmWorkExperience(string Company, string Role, string Period, string Description);
public record LlmEducation(string Institution, string Degree, string Field, string Period);

public record LlmGenerateResponse(
    string Summary,
    List<LlmWorkExperience> WorkExperiences,
    List<LlmEducation> Educations,
    List<string> Skills,
    List<string> Highlights
);

public record LlmOptimizeRequest(LlmProfileRequest Profile, string Message);

public record LlmOptimizeWorkExperience(string Company, string Role, string StartDate, string? EndDate, string Description);
public record LlmOptimizeSkill(string Name);

public record LlmOptimizeResponse(
    string Title,
    string Overview,
    List<LlmOptimizeWorkExperience> WorkExperiences,
    List<LlmOptimizeSkill> Skills
);

public record LlmExtractRequest(string CvText);

public record LlmExtractWorkExperience(string Company, string Role, string StartDate, string? EndDate, string Description);
public record LlmExtractEducation(string Institution, string Degree, string Field, int StartYear, int? EndYear);
public record LlmExtractSkill(string Name);

public record LlmExtractResponse(
    string FullName,
    string Title,
    string Overview,
    string? Location,
    string? ContactEmail,
    string? ContactPhone,
    List<LlmExtractWorkExperience> WorkExperiences,
    List<LlmExtractEducation> Educations,
    List<LlmExtractSkill> Skills
);

public record LlmEnhanceFieldRequest(string Content, string FieldPurpose);
public record LlmEnhanceFieldResponse(string Enhanced);

public record LlmChatMessage(string Role, string Content);
public record LlmChatRequest(LlmProfileRequest Profile, string Message, List<LlmChatMessage> History);
public record LlmChatProposal(string Type, string Description, string PatchJson);
public record LlmChatResponse(string Reply, LlmChatProposal? Proposal);

public record LlmProfileSummary(string Name, string Title, string Overview, List<string> Skills);
public record LlmUserChatRequest(List<LlmProfileSummary> Profiles, string Message, List<LlmChatMessage> History);
public record LlmUserChatResponse(string Reply);

public record LlmCoverLetterProfile(
    string Id,
    string FullName,
    string Title,
    string Overview,
    string? Location,
    List<LlmWorkInput> WorkExperiences,
    List<LlmEducationInput> Educations,
    List<LlmSkillInput> Skills
);

public record LlmCoverLetterRequest(
    List<LlmCoverLetterProfile> Profiles,
    string JobTitle,
    string JobDescription,
    string FieldContext
);

public record LlmCoverLetterResponse(string Text, Guid SelectedProfileId);

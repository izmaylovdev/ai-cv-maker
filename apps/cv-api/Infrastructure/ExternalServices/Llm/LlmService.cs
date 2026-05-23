using CvApi.Grpc;

namespace CvApi.Infrastructure.ExternalServices.Llm;

public class LlmService(CvApi.Grpc.LlmService.LlmServiceClient grpcClient) : ILlmService
{
    public async Task<LlmGenerateResponse> GenerateAsync(LlmGenerateRequest request)
    {
        var reply = await grpcClient.GenerateAsync(new GenerateRequest
        {
            Profile = MapProfile(request.Profile),
            Message = request.Message ?? string.Empty,
        });

        return new LlmGenerateResponse(
            reply.Summary,
            reply.WorkExperiences.Select(w => new LlmWorkExperience(w.Company, w.Role, w.Period, w.Description)).ToList(),
            reply.Educations.Select(e => new LlmEducation(e.Institution, e.Degree, e.Field, e.Period)).ToList(),
            reply.Skills.ToList(),
            reply.Highlights.ToList()
        );
    }

    public async Task<LlmOptimizeResponse> OptimizeAsync(LlmOptimizeRequest request)
    {
        var reply = await grpcClient.OptimizeAsync(new OptimizeRequest
        {
            Profile = MapProfile(request.Profile),
            Message = request.Message,
        });

        return new LlmOptimizeResponse(
            reply.Title,
            reply.Overview,
            reply.WorkExperiences.Select(w => new LlmOptimizeWorkExperience(
                w.Company, w.Role, w.StartDate, string.IsNullOrEmpty(w.EndDate) ? null : w.EndDate, w.Description
            )).ToList(),
            reply.Skills.Select(s => new LlmOptimizeSkill(s.Name)).ToList()
        );
    }

    public async Task<LlmExtractResponse> ExtractAsync(LlmExtractRequest request)
    {
        var reply = await grpcClient.ExtractProfileAsync(new ExtractProfileRequest
        {
            CvText = request.CvText,
        });

        return new LlmExtractResponse(
            reply.FullName,
            reply.Title,
            reply.Overview,
            string.IsNullOrEmpty(reply.Location) ? null : reply.Location,
            string.IsNullOrEmpty(reply.ContactEmail) ? null : reply.ContactEmail,
            string.IsNullOrEmpty(reply.ContactPhone) ? null : reply.ContactPhone,
            reply.WorkExperiences.Select(w => new LlmExtractWorkExperience(
                w.Company, w.Role, w.StartDate,
                string.IsNullOrEmpty(w.EndDate) ? null : w.EndDate,
                w.Description
            )).ToList(),
            reply.Educations.Select(e => new LlmExtractEducation(
                e.Institution, e.Degree, e.Field, e.StartYear,
                e.EndYear == 0 ? null : e.EndYear
            )).ToList(),
            reply.Skills.Select(s => new LlmExtractSkill(s.Name)).ToList()
        );
    }

    public async Task<LlmEnhanceFieldResponse> EnhanceFieldAsync(LlmEnhanceFieldRequest request)
    {
        var reply = await grpcClient.EnhanceFieldAsync(new CvApi.Grpc.EnhanceFieldRequest
        {
            Content = request.Content,
            FieldPurpose = request.FieldPurpose,
        });
        return new LlmEnhanceFieldResponse(reply.Enhanced);
    }

    private static ProfileInput MapProfile(LlmProfileRequest p) => new()
    {
        FullName = p.FullName,
        Title = p.Title,
        Overview = p.Overview,
        Location = p.Location ?? string.Empty,
        WorkExperiences =
        {
            p.WorkExperiences.Select(w => new WorkExperienceInput
            {
                Id = w.Id?.ToString() ?? string.Empty,
                Company = w.Company,
                Role = w.Role,
                StartDate = w.StartDate.ToString(),
                EndDate = w.EndDate?.ToString() ?? string.Empty,
                Description = w.Description,
            })
        },
        Educations =
        {
            p.Educations.Select(e => new EducationInput
            {
                Id = e.Id?.ToString() ?? string.Empty,
                Institution = e.Institution,
                Degree = e.Degree,
                Field = e.Field,
                StartYear = e.StartYear,
                EndYear = e.EndYear ?? 0,
            })
        },
        Skills =
        {
            p.Skills.Select(s => new SkillInput
            {
                Id = s.Id?.ToString() ?? string.Empty,
                Name = s.Name,
            })
        },
    };
}

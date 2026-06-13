using System.Text;
using CvApi.Domain.Entities;
using CvApi.Features.JobProfiles.Dtos;
using CvApi.Features.Usage;
using CvApi.Infrastructure.ExternalServices.Llm;
using CvApi.Infrastructure.Persistence;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using UglyToad.PdfPig;

namespace CvApi.Features.JobProfiles;

public class JobProfileService(AppDbContext db, ILlmService llmService, UsageService usageService) : IJobProfileService
{
    public async Task<List<JobProfileListItemDto>> ListAsync(Guid userId)
    {
        return await db.Profiles
            .Where(p => p.UserId == userId)
            .OrderBy(p => p.Name)
            .Select(p => new JobProfileListItemDto(p.Id, p.Name, p.FullName, p.Title))
            .ToListAsync();
    }

    public async Task<JobProfileListItemDto> CreateAsync(Guid userId, CreateJobProfileRequest request)
    {
        var profile = new Profile
        {
            UserId = userId,
            Name = string.IsNullOrWhiteSpace(request.Name) ? "My Profile" : request.Name.Trim(),
        };
        db.Profiles.Add(profile);
        await db.SaveChangesAsync();
        return new JobProfileListItemDto(profile.Id, profile.Name, profile.FullName, profile.Title);
    }

    public async Task<ProfileDto?> GetAsync(Guid id, Guid userId)
    {
        var profile = await db.Profiles
            .Include(p => p.WorkExperiences)
            .Include(p => p.Educations)
            .Include(p => p.Skills)
            .FirstOrDefaultAsync(p => p.Id == id && p.UserId == userId);

        return profile is null ? null : MapToDto(profile);
    }

    public async Task<ProfileDto?> UpdateAsync(Guid id, Guid userId, UpdateProfileRequest request)
    {
        var profile = await db.Profiles
            .Include(p => p.WorkExperiences)
            .Include(p => p.Educations)
            .Include(p => p.Skills)
            .FirstOrDefaultAsync(p => p.Id == id && p.UserId == userId);

        if (profile is null) return null;

        profile.Name = string.IsNullOrWhiteSpace(request.Name) ? profile.Name : request.Name.Trim();
        profile.FullName = request.FullName;
        profile.Title = request.Title;
        profile.Overview = request.Overview;
        profile.Location = string.IsNullOrWhiteSpace(request.Location) ? null : request.Location.Trim();
        profile.ContactEmail = request.Contacts?.Email;
        profile.ContactPhone = request.Contacts?.Phone;
        if (request.SectionOrder is { Count: > 0 })
            profile.SectionOrder = string.Join(",", request.SectionOrder);

        db.WorkExperiences.RemoveRange(profile.WorkExperiences);
        db.Educations.RemoveRange(profile.Educations);
        db.Skills.RemoveRange(profile.Skills);

        var workExperiences = request.WorkExperiences.Select(w => new WorkExperience
        {
            ProfileId = profile.Id,
            Company = w.Company,
            Role = w.Role,
            StartDate = w.StartDate,
            EndDate = w.EndDate,
            Description = w.Description
        }).ToList();

        var educations = request.Educations.Select(e => new Education
        {
            ProfileId = profile.Id,
            Institution = e.Institution,
            Degree = e.Degree,
            Field = e.Field,
            StartYear = e.StartYear,
            EndYear = e.EndYear
        }).ToList();

        var skills = request.Skills.Select((s, i) => new Skill
        {
            ProfileId = profile.Id,
            Name = s.Name,
            Order = i,
        }).ToList();

        db.WorkExperiences.AddRange(workExperiences);
        db.Educations.AddRange(educations);
        db.Skills.AddRange(skills);

        await db.SaveChangesAsync();

        profile.WorkExperiences = workExperiences;
        profile.Educations = educations;
        profile.Skills = skills;

        return MapToDto(profile);
    }

    public async Task<bool> DeleteAsync(Guid id, Guid userId)
    {
        var profile = await db.Profiles.FirstOrDefaultAsync(p => p.Id == id && p.UserId == userId);
        if (profile is null) return false;
        db.Profiles.Remove(profile);
        await db.SaveChangesAsync();
        return true;
    }

    public async Task<OptimizeProfileResponse?> OptimizeAsync(Guid id, Guid userId, OptimizeProfileRequest request)
    {
        var profile = await db.Profiles
            .Include(p => p.WorkExperiences)
            .Include(p => p.Educations)
            .Include(p => p.Skills)
            .FirstOrDefaultAsync(p => p.Id == id && p.UserId == userId);

        if (profile is null) return null;

        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == userId);

        var llmRequest = new LlmOptimizeRequest(
            new LlmProfileRequest(
                profile.FullName,
                profile.Title,
                profile.Overview,
                profile.Location,
                profile.WorkExperiences
                    .OrderByDescending(w => w.EndDate ?? DateOnly.MaxValue)
                    .ThenByDescending(w => w.StartDate)
                    .Select(w => new LlmWorkInput(w.Id, w.Company, w.Role, w.StartDate, w.EndDate, w.Description))
                    .ToList(),
                profile.Educations
                    .OrderByDescending(e => e.EndYear ?? int.MaxValue)
                    .ThenByDescending(e => e.StartYear)
                    .Select(e => new LlmEducationInput(e.Id, e.Institution, e.Degree, e.Field, e.StartYear, e.EndYear))
                    .ToList(),
                profile.Skills.OrderBy(s => s.Order).Select(s => new LlmSkillInput(s.Id, s.Name)).ToList()
            ),
            request.Message,
            string.IsNullOrWhiteSpace(user?.GlobalPreferences) ? null : user.GlobalPreferences
        );

        await usageService.EnsureWithinLimitAsync(userId);
        var llmResponse = await llmService.OptimizeAsync(llmRequest);
        await usageService.RecordAsync(userId, "Optimize", llmResponse.Usage);

        return new OptimizeProfileResponse(
            llmResponse.Title,
            llmResponse.Overview,
            llmResponse.WorkExperiences
                .Select(w => new OptimizeWorkExperienceDto(w.Company, w.Role, w.StartDate, w.EndDate, w.Description))
                .ToList(),
            llmResponse.Skills
                .Select(s => new OptimizeSkillDto(s.Name))
                .ToList()
        );
    }

    public async Task<UpdateProfileRequest?> ExtractAsync(Guid id, Guid userId, IFormFile file)
    {
        var exists = await db.Profiles.AnyAsync(p => p.Id == id && p.UserId == userId);
        if (!exists) return null;

        string cvText;
        var ext = Path.GetExtension(file.FileName).ToLowerInvariant();

        if (ext == ".pdf")
        {
            using var ms = new MemoryStream();
            await file.CopyToAsync(ms);
            ms.Position = 0;
            var sb = new StringBuilder();
            using var pdf = PdfDocument.Open(ms);
            foreach (var page in pdf.GetPages())
                sb.AppendLine(page.Text);
            cvText = sb.ToString();
        }
        else
        {
            using var reader = new StreamReader(file.OpenReadStream(), Encoding.UTF8);
            cvText = await reader.ReadToEndAsync();
        }

        if (string.IsNullOrWhiteSpace(cvText))
            throw new InvalidOperationException("Could not extract text from the uploaded file.");

        await usageService.EnsureWithinLimitAsync(userId);
        var llmResponse = await llmService.ExtractAsync(new LlmExtractRequest(cvText));
        await usageService.RecordAsync(userId, "Extract", llmResponse.Usage);

        var profile = await db.Profiles.FirstAsync(p => p.Id == id);

        return new UpdateProfileRequest(
            profile.Name,
            llmResponse.FullName,
            llmResponse.Title,
            llmResponse.Overview,
            string.IsNullOrWhiteSpace(llmResponse.Location) ? null : llmResponse.Location,
            new ContactsDto(llmResponse.ContactEmail, llmResponse.ContactPhone),
            llmResponse.WorkExperiences.Select(w => new WorkExperienceDto(
                null, w.Company, w.Role,
                DateOnly.TryParse(w.StartDate, out var sd) ? sd : DateOnly.FromDateTime(DateTime.Today),
                string.IsNullOrEmpty(w.EndDate) ? null : DateOnly.TryParse(w.EndDate, out var ed) ? ed : null,
                w.Description
            )).ToList(),
            llmResponse.Educations.Select(e => new EducationDto(
                null, e.Institution, e.Degree, e.Field, e.StartYear, e.EndYear
            )).ToList(),
            llmResponse.Skills.Select(s => new SkillDto(null, s.Name)).ToList(),
            profile.SectionOrder.Split(',').ToList()
        );
    }

    public async Task<ChatResponse?> ChatAsync(Guid id, Guid userId, ChatRequest request)
    {
        var profile = await db.Profiles
            .Include(p => p.WorkExperiences)
            .Include(p => p.Educations)
            .Include(p => p.Skills)
            .FirstOrDefaultAsync(p => p.Id == id && p.UserId == userId);

        if (profile is null) return null;

        var llmRequest = new LlmChatRequest(
            new LlmProfileRequest(
                profile.FullName,
                profile.Title,
                profile.Overview,
                profile.Location,
                profile.WorkExperiences
                    .OrderByDescending(w => w.StartDate)
                    .Select(w => new LlmWorkInput(w.Id, w.Company, w.Role, w.StartDate, w.EndDate, w.Description))
                    .ToList(),
                profile.Educations
                    .Select(e => new LlmEducationInput(e.Id, e.Institution, e.Degree, e.Field, e.StartYear, e.EndYear))
                    .ToList(),
                profile.Skills.OrderBy(s => s.Order).Select(s => new LlmSkillInput(s.Id, s.Name)).ToList()
            ),
            request.Message,
            (request.History ?? []).Select(h => new LlmChatMessage(h.Role, h.Content)).ToList()
        );

        await usageService.EnsureWithinLimitAsync(userId);
        var llmResponse = await llmService.ChatAsync(llmRequest);
        await usageService.RecordAsync(userId, "Chat", llmResponse.Usage);

        ChatProposalDto? proposal = null;
        if (llmResponse.Proposal is not null)
            proposal = new ChatProposalDto(llmResponse.Proposal.Type, llmResponse.Proposal.Description, llmResponse.Proposal.PatchJson);

        return new ChatResponse(llmResponse.Reply, proposal);
    }

    private static ProfileDto MapToDto(Profile profile) => new(
        profile.Id,
        profile.Name,
        profile.FullName,
        profile.Title,
        profile.Overview,
        profile.Location,
        new ContactsDto(profile.ContactEmail, profile.ContactPhone),
        profile.WorkExperiences.OrderByDescending(w => w.StartDate).Select(w => new WorkExperienceDto(
            w.Id, w.Company, w.Role, w.StartDate, w.EndDate, w.Description)).ToList(),
        profile.Educations.Select(e => new EducationDto(
            e.Id, e.Institution, e.Degree, e.Field, e.StartYear, e.EndYear)).ToList(),
        profile.Skills.OrderBy(s => s.Order).Select(s => new SkillDto(s.Id, s.Name)).ToList(),
        profile.SectionOrder.Split(',').ToList()
    );
}

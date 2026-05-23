using System.Text.Json;
using CvApi.Domain.Entities;
using CvApi.Features.Cvs.Dtos;
using CvApi.Infrastructure.ExternalServices.Llm;
using CvApi.Infrastructure.ExternalServices.Pdf;
using CvApi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace CvApi.Features.Cvs;

public class CvService(AppDbContext db, ILlmService llmService, IPdfService pdfService) : ICvService
{
    private static readonly JsonSerializerOptions _jsonOptions = new() { PropertyNameCaseInsensitive = true };
    private static readonly JsonSerializerOptions _jsonCamelCase = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    public async Task<List<CvListItemDto>?> GetAllAsync(Guid profileId, Guid userId)
    {
        var ownedProfile = await db.Profiles.FirstOrDefaultAsync(p => p.Id == profileId && p.UserId == userId);
        if (ownedProfile is null) return null;

        return await db.GeneratedCvs
            .Where(g => g.ProfileId == profileId)
            .OrderByDescending(g => g.CreatedAt)
            .Select(g => new CvListItemDto(g.Id, g.CreatedAt, g.OptimizationNotes, g.Title))
            .ToListAsync();
    }

    public async Task<CvListItemDto?> CreateAsync(Guid profileId, Guid userId, CreateCvRequest request)
    {
        var profile = await db.Profiles
            .Include(p => p.WorkExperiences)
            .Include(p => p.Educations)
            .Include(p => p.Skills)
            .FirstOrDefaultAsync(p => p.Id == profileId && p.UserId == userId);

        if (profile is null) return null;

        var llmRequest = new LlmGenerateRequest(
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
            string.IsNullOrWhiteSpace(request.OptimizationNotes) ? null : request.OptimizationNotes
        );

        var llmResponse = await llmService.GenerateAsync(llmRequest);

        var generatedCv = new GeneratedCv
        {
            ProfileId = profile.Id,
            OptimizationNotes = string.IsNullOrWhiteSpace(request.OptimizationNotes) ? null : request.OptimizationNotes.Trim(),
            FullName = profile.FullName,
            Title = profile.Title,
            Location = profile.Location,
            ContactEmail = profile.ContactEmail,
            ContactPhone = profile.ContactPhone,
            CvDataJson = JsonSerializer.Serialize(llmResponse, _jsonCamelCase)
        };

        db.GeneratedCvs.Add(generatedCv);
        await db.SaveChangesAsync();

        return new CvListItemDto(generatedCv.Id, generatedCv.CreatedAt, generatedCv.OptimizationNotes, generatedCv.Title);
    }

    public async Task<(byte[] Bytes, string Filename)?> GetPdfAsync(Guid profileId, Guid id, Guid userId)
    {
        var ownedProfile = await db.Profiles.FirstOrDefaultAsync(p => p.Id == profileId && p.UserId == userId);
        if (ownedProfile is null) return null;

        var cv = await db.GeneratedCvs.FirstOrDefaultAsync(g => g.Id == id && g.ProfileId == profileId);
        if (cv is null) return null;

        var cvData = JsonSerializer.Deserialize<LlmGenerateResponse>(cv.CvDataJson, _jsonOptions)
            ?? throw new InvalidOperationException("CV data is corrupted.");

        var sectionOrder = ownedProfile.SectionOrder.Split(',').ToList();
        var pdf = pdfService.GenerateCv(cvData, cv.FullName, cv.Title, cv.Location, cv.ContactEmail, cv.ContactPhone, sectionOrder);
        return (pdf, $"{cv.FullName.Replace(" ", "_")}_CV.pdf");
    }

    public async Task<(byte[] Bytes, string Filename)?> GetDefaultPdfAsync(Guid profileId, Guid userId)
    {
        var profile = await db.Profiles
            .Include(p => p.WorkExperiences)
            .Include(p => p.Educations)
            .Include(p => p.Skills)
            .FirstOrDefaultAsync(p => p.Id == profileId && p.UserId == userId);

        if (profile is null) return null;

        var cvData = new LlmGenerateResponse(
            Summary: profile.Overview,
            WorkExperiences: profile.WorkExperiences
                .OrderByDescending(w => w.EndDate ?? DateOnly.MaxValue)
                .ThenByDescending(w => w.StartDate)
                .Select(w => new LlmWorkExperience(
                    w.Company, w.Role, FormatPeriod(w.StartDate, w.EndDate), w.Description ?? ""))
                .ToList(),
            Educations: profile.Educations
                .OrderByDescending(e => e.EndYear ?? int.MaxValue)
                .ThenByDescending(e => e.StartYear)
                .Select(e => new LlmEducation(
                    e.Institution, e.Degree, e.Field,
                    e.EndYear.HasValue ? $"{e.StartYear} – {e.EndYear}" : $"{e.StartYear} – Present"))
                .ToList(),
            Skills: profile.Skills.OrderBy(s => s.Order).Select(s => s.Name).ToList(),
            Highlights: []
        );

        var sectionOrder = profile.SectionOrder.Split(',').ToList();
        var pdf = pdfService.GenerateCv(cvData, profile.FullName, profile.Title, profile.Location, profile.ContactEmail, profile.ContactPhone, sectionOrder);
        return (pdf, $"{profile.FullName.Replace(" ", "_")}_CV.pdf");
    }

    public async Task<bool> DeleteAsync(Guid profileId, Guid id, Guid userId)
    {
        var ownedProfile = await db.Profiles.FirstOrDefaultAsync(p => p.Id == profileId && p.UserId == userId);
        if (ownedProfile is null) return false;

        var cv = await db.GeneratedCvs.FirstOrDefaultAsync(g => g.Id == id && g.ProfileId == profileId);
        if (cv is null) return false;

        db.GeneratedCvs.Remove(cv);
        await db.SaveChangesAsync();
        return true;
    }

    private static string FormatPeriod(DateOnly start, DateOnly? end)
    {
        var s = start.ToString("MMM yyyy");
        var e = end.HasValue ? end.Value.ToString("MMM yyyy") : "Present";
        return $"{s} – {e}";
    }
}

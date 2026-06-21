using System.Text.Json;
using CvApi.Domain.Entities;
using CvApi.Features.Cvs.Dtos;
using CvApi.Features.JobProfiles.Dtos;
using CvApi.Features.Usage;
using CvApi.Infrastructure.ExternalServices.Llm;
using CvApi.Infrastructure.ExternalServices.Pdf;
using CvApi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace CvApi.Features.Cvs;

public class CvService(AppDbContext db, ILlmService llmService, IPdfService pdfService, UsageService usageService) : ICvService
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
        var profile = await db.Profiles.FirstOrDefaultAsync(p => p.Id == profileId && p.UserId == userId);
        if (profile is null) return null;

        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == userId);

        var llmRequest = new LlmGenerateRequest(
            profile.Document,
            string.IsNullOrWhiteSpace(request.OptimizationNotes) ? null : request.OptimizationNotes,
            string.IsNullOrWhiteSpace(user?.GlobalPreferences) ? null : user.GlobalPreferences
        );

        await usageService.EnsureWithinLimitAsync(userId);
        var llmResponse = await llmService.GenerateAsync(llmRequest);
        await usageService.RecordAsync(userId, "Generate", llmResponse.Usage);

        var generatedCv = NewSnapshot(profile, llmResponse,
            string.IsNullOrWhiteSpace(request.OptimizationNotes) ? null : request.OptimizationNotes.Trim());

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

        // The generated-CV snapshot stores the AI-authored ProfileDocument (ADR-0013).
        var document = JsonSerializer.Deserialize<ProfileDocument>(cv.CvDataJson, _jsonOptions)
            ?? throw new InvalidOperationException("CV data is corrupted.");

        var pdf = pdfService.GenerateFromDocument(document);
        return (pdf, $"{cv.FullName.Replace(" ", "_")}_CV.pdf");
    }

    public async Task<(byte[] Bytes, string Filename)?> GetDefaultPdfAsync(Guid profileId, Guid userId)
    {
        var profile = await db.Profiles.FirstOrDefaultAsync(p => p.Id == profileId && p.UserId == userId);
        if (profile is null) return null;

        var pdf = pdfService.GenerateFromDocument(profile.Document);
        return (pdf, $"{profile.Document.Header.FullName.Replace(" ", "_")}_CV.pdf");
    }

    public Task<(byte[] Bytes, string Filename)> GetDraftPdfAsync(UpdateProfileRequest data)
    {
        var doc = data.Document ?? ProfileDocument.Empty();
        var pdf = pdfService.GenerateFromDocument(doc);
        return Task.FromResult((pdf, $"{doc.Header.FullName.Replace(" ", "_")}_CV.pdf"));
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

    public async Task<GenerateAutoResponse?> GenerateAutoAsync(Guid userId, GenerateAutoRequest request)
    {
        var profiles = await db.Profiles.Where(p => p.UserId == userId).ToListAsync();
        if (profiles.Count == 0) return null;

        await usageService.EnsureWithinLimitAsync(userId);

        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == userId);

        Guid selectedProfileId;
        if (profiles.Count == 1)
        {
            selectedProfileId = profiles[0].Id;
        }
        else
        {
            var selectRequest = new LlmSelectBestProfileRequest(
                profiles.Select(p => new LlmProfileWithId(p.Id.ToString(), p.Document)).ToList(),
                request.JobDescription
            );

            var selectResult = await llmService.SelectBestProfileAsync(selectRequest);
            selectedProfileId = selectResult.SelectedProfileId;
        }

        var profile = profiles.First(p => p.Id == selectedProfileId);

        var llmRequest = new LlmGenerateRequest(
            profile.Document,
            string.IsNullOrWhiteSpace(request.JobDescription) ? null : request.JobDescription,
            string.IsNullOrWhiteSpace(user?.GlobalPreferences) ? null : user.GlobalPreferences
        );

        var llmResponse = await llmService.GenerateAsync(llmRequest);
        await usageService.RecordAsync(userId, "GenerateAuto", llmResponse.Usage);

        var generatedCv = NewSnapshot(profile, llmResponse, request.JobDescription.Trim());
        db.GeneratedCvs.Add(generatedCv);
        await db.SaveChangesAsync();

        return new GenerateAutoResponse(generatedCv.Id, profile.Id, profile.Document.Header.FullName);
    }

    // Snapshots the profile's identity + the AI-authored ProfileDocument (ADR-0013)
    // at generation time, so a generated CV is reproducible and renders directly.
    private GeneratedCv NewSnapshot(Profile profile, LlmGenerateResponse llmResponse, string? notes)
    {
        var header = llmResponse.Document.Header;
        return new GeneratedCv
        {
            ProfileId = profile.Id,
            OptimizationNotes = notes,
            FullName = header.FullName,
            Title = header.Title,
            Location = Nz(header.Location),
            ContactEmail = Nz(header.Email),
            ContactPhone = Nz(header.Phone),
            CvDataJson = JsonSerializer.Serialize(llmResponse.Document, _jsonCamelCase),
        };
    }

    private static string? Nz(string? s) => string.IsNullOrWhiteSpace(s) ? null : s;
}

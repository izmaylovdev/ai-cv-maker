using CvApi.Domain.Entities;
using CvApi.Features.Usage;
using CvApi.Infrastructure.ExternalServices.Llm;
using CvApi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace CvApi.Features.CoverLetter;

public class CoverLetterService(AppDbContext db, ILlmService llmService, UsageService usageService)
{
    public async Task<GenerateCoverLetterResponse> GenerateAsync(Guid userId, GenerateCoverLetterRequest request)
    {
        List<Profile> profiles;

        if (request.ProfileIdOverride.HasValue)
        {
            var profile = await db.Profiles
                .FirstOrDefaultAsync(p => p.Id == request.ProfileIdOverride.Value && p.UserId == userId);

            if (profile is null)
                throw new KeyNotFoundException($"Profile {request.ProfileIdOverride} not found.");

            profiles = [profile];
        }
        else
        {
            profiles = await db.Profiles
                .Where(p => p.UserId == userId)
                .ToListAsync();

            if (profiles.Count == 0)
                throw new InvalidOperationException("No profiles found. Create a profile before generating a cover letter.");
        }

        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == userId);

        var llmRequest = new LlmCoverLetterRequest(
            Profiles: profiles.Select(p => new LlmProfileWithId(p.Id.ToString(), p.Document)).ToList(),
            JobTitle: request.JobTitle,
            JobDescription: request.JobDescription,
            FieldContext: request.FieldContext,
            GlobalPreferences: string.IsNullOrWhiteSpace(user?.GlobalPreferences) ? null : user.GlobalPreferences
        );

        await usageService.EnsureWithinLimitAsync(userId);
        var result = await llmService.GenerateCoverLetterAsync(llmRequest);
        await usageService.RecordAsync(userId, "CoverLetter", result.Usage ?? LlmTokenUsage.Empty);

        var selectedProfile = profiles.FirstOrDefault(p => p.Id == result.SelectedProfileId)
            ?? profiles[0];

        return new GenerateCoverLetterResponse(
            Text: result.Text,
            SelectedProfileId: selectedProfile.Id,
            SelectedProfileName: selectedProfile.Name
        );
    }
}

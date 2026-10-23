using System.Text;
using CvApi.Domain.Entities;
using CvApi.Features.JobProfiles.Dtos;
using CvApi.Features.Usage;
using CvApi.Infrastructure.ExternalServices.Llm;
using CvApi.Domain.Repositories;
using Microsoft.AspNetCore.Http;
using UglyToad.PdfPig;

namespace CvApi.Features.JobProfiles;

public class JobProfileService(IProfileRepository profiles, ILlmService llmService, UsageService usageService) : IJobProfileService
{
    public async Task<List<JobProfileListItemDto>> ListAsync(Guid userId)
    {
        // Document lives in a value-converted jsonb column, so its fields can't be
        // projected in SQL — load the (few) profiles and read the header in memory.
        var profileList = (await profiles.ListByUserAsync(userId))
            .OrderBy(p => p.Name)
            .ToList();

        return profileList
            .Select(p => new JobProfileListItemDto(p.Id, p.Name, p.Document.Header.FullName, p.Document.Header.Title))
            .ToList();
    }

    public async Task<JobProfileListItemDto> CreateAsync(Guid userId, CreateJobProfileRequest request)
    {
        var profile = new Profile
        {
            UserId = userId,
            Name = string.IsNullOrWhiteSpace(request.Name) ? "My Profile" : request.Name.Trim(),
            // US-PROF-6: seed a default CV template (titled sections + empty
            // scaffolding) rather than a blank body, so users start with structure.
            Document = ProfileDocument.DefaultTemplate(),
        };
        await profiles.AddAsync(profile);
        return new JobProfileListItemDto(profile.Id, profile.Name, profile.Document.Header.FullName, profile.Document.Header.Title);
    }

    public async Task<ProfileDto?> GetAsync(Guid id, Guid userId)
    {
        var profile = await profiles.GetForUserAsync(id, userId);
        if (profile is null) return null;
        var document = ProfileDocumentSchema.MigrateLegacy(profile.Document);
        return new ProfileDto(profile.Id, profile.Name, document);
    }

    public async Task<ProfileDto?> UpdateAsync(Guid id, Guid userId, UpdateProfileRequest request)
    {
        var profile = await profiles.GetForUserAsync(id, userId);
        if (profile is null) return null;

        var document = ProfileDocumentSchema.MigrateLegacy(
            request.Document ?? ProfileDocument.Empty());
        var validationError = ProfileDocumentSchema.Validate(document.Body);
        if (validationError is not null)
            throw new InvalidProfileDocumentException(validationError);

        if (!string.IsNullOrWhiteSpace(request.Name)) profile.Name = request.Name.Trim();
        profile.Document = document;

        await profiles.UpdateAsync(profile);
        return new ProfileDto(profile.Id, profile.Name, profile.Document);
    }

    // US-PROF-7: name-only rename — the document is never read or written here.
    public async Task<JobProfileListItemDto?> RenameAsync(Guid id, Guid userId, string name)
    {
        var profile = await profiles.GetForUserAsync(id, userId);
        if (profile is null) return null;

        profile.Name = name.Trim();
        await profiles.UpdateAsync(profile);
        return new JobProfileListItemDto(profile.Id, profile.Name, profile.Document.Header.FullName, profile.Document.Header.Title);
    }

    public async Task<bool> DeleteAsync(Guid id, Guid userId)
    {
        var profile = await profiles.GetForUserAsync(id, userId);
        if (profile is null) return false;
        await profiles.DeleteAsync(profile);
        return true;
    }

    public async Task<UpdateProfileRequest?> ExtractAsync(Guid id, Guid userId, IFormFile file)
    {
        var profile = await profiles.GetForUserAsync(id, userId);
        if (profile is null) return null;

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

        // Migrate any legacy section/link nodes the LLM may still emit (transition period).
        var document = ProfileDocumentSchema.MigrateLegacy(llmResponse.Document);

        // F-PROF-8.3: prefer the LLM-suggested profile name (trimmed, capped at
        // 100 chars); fall back to the current name when the LLM produced none.
        var llmName = llmResponse.ProfileName.Trim();
        var suggestedName = llmName.Length == 0
            ? profile.Name
            : llmName.Length > 100 ? llmName[..100] : llmName;
        return new UpdateProfileRequest(suggestedName, document);
    }

    public async Task<ChatResponse?> ChatAsync(Guid id, Guid userId, ChatRequest request)
    {
        var profile = await profiles.GetForUserAsync(id, userId);
        if (profile is null) return null;

        var llmRequest = new LlmChatRequest(
            profile.Document,
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
}

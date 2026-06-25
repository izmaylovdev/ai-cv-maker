using CvApi.Domain.Entities;

namespace CvApi.Infrastructure.ExternalServices.Llm;

public record LlmTokenUsage(int PromptTokens, int CompletionTokens, string ModelName)
{
    public static LlmTokenUsage Empty => new(0, 0, string.Empty);
}

// All AI operations speak the canonical ProfileDocument (ADR-0013): the profile
// goes in as a document, and Generate/Extract return the AI-authored
// document back.

public record LlmGenerateRequest(ProfileDocument Profile, string? Message = null, string? GlobalPreferences = null);
public record LlmGenerateResponse(ProfileDocument Document, LlmTokenUsage Usage);

public record LlmExtractRequest(string CvText);
public record LlmExtractResponse(ProfileDocument Document, LlmTokenUsage Usage);

public record LlmChatMessage(string Role, string Content);
public record LlmChatRequest(ProfileDocument Profile, string Message, List<LlmChatMessage> History);
public record LlmChatProposal(string Type, string Description, string PatchJson);
public record LlmChatResponse(string Reply, LlmChatProposal? Proposal, LlmTokenUsage Usage);

public record LlmProfileSummary(string Name, string Title, string Overview, List<string> Skills);
public record LlmUserChatRequest(List<LlmProfileSummary> Profiles, string Message, List<LlmChatMessage> History, string? GlobalPreferences = null);
public record LlmUserChatResponse(string Reply, string? PreferencesUpdate = null, LlmTokenUsage? Usage = null);

// A profile document tagged with the owning profile id, so the response (a
// selected_profile_id) maps back to a Profile.
public record LlmProfileWithId(string Id, ProfileDocument Document);

public record LlmCoverLetterRequest(
    List<LlmProfileWithId> Profiles,
    string JobTitle,
    string JobDescription,
    string FieldContext,
    string? GlobalPreferences = null
);

public record LlmCoverLetterResponse(string Text, Guid SelectedProfileId, LlmTokenUsage? Usage = null);

public record LlmSelectBestProfileRequest(List<LlmProfileWithId> Profiles, string JobDescription);
public record LlmSelectBestProfileResponse(Guid SelectedProfileId);

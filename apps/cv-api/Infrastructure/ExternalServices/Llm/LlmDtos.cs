using CvApi.Domain.Entities;

namespace CvApi.Infrastructure.ExternalServices.Llm;

// CacheReadTokens / CacheWriteTokens (US-AI-17): prompt-cache hits and writes,
// counted separately because providers exclude them from PromptTokens.
public record LlmTokenUsage(int PromptTokens, int CompletionTokens, string ModelName, int CacheReadTokens = 0, int CacheWriteTokens = 0)
{
    public static LlmTokenUsage Empty => new(0, 0, string.Empty);
}

// All AI operations speak the canonical ProfileDocument (ADR-0013): the profile
// goes in as a document, and Generate/Extract return the AI-authored
// document back.

public record LlmGenerateRequest(ProfileDocument Profile, string? Message = null, string? GlobalPreferences = null);
public record LlmGenerateResponse(ProfileDocument Document, LlmTokenUsage Usage);

public record LlmExtractRequest(string CvText);
// ProfileName (US-PROF-8): the LLM-suggested profile name; "" when the model produced none.
public record LlmExtractResponse(ProfileDocument Document, LlmTokenUsage Usage, string ProfileName = "");

public record LlmChatMessage(string Role, string Content);
// US-AI-13 — one of the user's other saved profiles, so the in-editor agent can
// read it on demand via the list_profiles / get_profile tools.
public record LlmOtherProfile(string Id, string Name, ProfileDocument Document);
public record LlmChatRequest(
    ProfileDocument Profile,
    string Message,
    List<LlmChatMessage> History,
    List<LlmOtherProfile>? OtherProfiles = null,
    string? SessionId = null);
// `Text` carries a "fill" proposal's draft (US-EXT-4); `PatchJson` an "edit" proposal's patch.
public record LlmChatProposal(string Type, string Description, string PatchJson, string? Text = null);
public record LlmChatResponse(string Reply, LlmChatProposal? Proposal, LlmTokenUsage Usage);

public record LlmProfileSummary(string Name, string Title, string Overview, List<string> Skills);
public record LlmUserChatRequest(List<LlmProfileSummary> Profiles, string Message, List<LlmChatMessage> History, string? GlobalPreferences = null, string? SessionId = null);
public record LlmUserChatResponse(string Reply, string? PreferencesUpdate = null, LlmTokenUsage? Usage = null);

// US-EXT-4 — side-panel chat about an open job posting (profile summaries + the
// posting as context). Returns a reply and optionally a "fill" proposal.
public record LlmJobChatRequest(
    List<LlmProfileSummary> Profiles,
    string JobTitle,
    string JobDescription,
    string FieldContext,
    string Message,
    List<LlmChatMessage> History,
    string? SessionId = null
);
public record LlmJobChatResponse(string Reply, LlmChatProposal? Proposal, LlmTokenUsage Usage);

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

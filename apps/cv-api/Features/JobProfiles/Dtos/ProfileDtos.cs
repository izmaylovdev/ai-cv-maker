using CvApi.Domain.Entities;

namespace CvApi.Features.JobProfiles.Dtos;

public record JobProfileListItemDto(Guid Id, string Name, string FullName, string Title);

// Canonical profile payload (ADR-0014): the block-tree document (flat title/flow nodes),
// exactly the shape the <applysy-profile-builder> web component emits/consumes.
public record ProfileDto(Guid Id, string Name, ProfileDocument Document);

public record CreateJobProfileRequest(string Name);

public record UpdateProfileRequest(string Name, ProfileDocument Document);

public record OptimizeProfileRequest(string Message);

// Optimize returns the AI-rewritten canonical document (ADR-0013); the client
// previews/applies it the same way it edits a profile.
public record OptimizeProfileResponse(ProfileDocument Document);

public record EnhanceFieldRequest(string Content, string FieldPurpose);
public record EnhanceFieldResponse(string Enhanced);

public record ChatMessageDto(string Role, string Content);
public record ChatRequest(string Message, List<ChatMessageDto>? History = null);
public record ChatProposalDto(string Type, string Description, string PatchJson);
public record ChatResponse(string Reply, ChatProposalDto? Proposal);

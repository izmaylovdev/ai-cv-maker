using CvApi.Domain.Entities;

namespace CvApi.Features.JobProfiles.Dtos;

public record JobProfileListItemDto(Guid Id, string Name, string FullName, string Title);

// Canonical profile payload (ADR-0014): the block-tree document (flat title/flow nodes),
// exactly the shape the <applysy-profile-builder> web component emits/consumes.
public record ProfileDto(Guid Id, string Name, ProfileDocument Document);

public record CreateJobProfileRequest(string Name);

public record UpdateProfileRequest(string Name, ProfileDocument Document);

public record ChatMessageDto(string Role, string Content);
public record ChatRequest(string Message, List<ChatMessageDto>? History = null);
// `PatchJson` carries an "edit" proposal's patch; `Text` a "fill" proposal's
// draft (US-EXT-4). Only one is populated per proposal `Type`.
public record ChatProposalDto(string Type, string Description, string PatchJson, string? Text = null);
public record ChatResponse(string Reply, ChatProposalDto? Proposal);

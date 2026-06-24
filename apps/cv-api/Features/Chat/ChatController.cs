using System.Security.Claims;
using CvApi.Domain.Entities;
using CvApi.Features.JobProfiles.Dtos;
using CvApi.Features.Usage;
using CvApi.Infrastructure.ExternalServices.Llm;
using CvApi.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace CvApi.Features.Chat;

[ApiController]
[Route("api/chat")]
[Authorize]
public class ChatController(AppDbContext db, ILlmService llmService, UsageService usageService) : ControllerBase
{
    private Guid UserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpPost]
    public async Task<ActionResult<UserChatResponse>> Chat(UserChatRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Message))
            return BadRequest("Message is required.");

        await usageService.EnsureWithinLimitAsync(UserId);

        // Edit mode (US-AI-9): the in-editor chat sends the open (possibly
        // unsaved) document. Route it to the per-profile Chat agent, which can
        // return a structured edit. Nothing is persisted here — the document is
        // taken from the request and the frontend applies the patch to the live
        // editor; the user saves via the normal profile-save flow.
        if (request.Document is not null)
            return await EditAsync(request);

        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == UserId);

        var profiles = await db.Profiles
            .Where(p => p.UserId == UserId)
            .OrderBy(p => p.Name)
            .ToListAsync();

        // Summarise each document (ADR-0013) into the lightweight chat-agent shape.
        var summaries = profiles
            .Select(p => DocumentSummary.Summarise(p.Name, p.Document))
            .ToList();

        const int maxHistoryMessages = 30;
        var history = (request.History ?? [])
            .TakeLast(maxHistoryMessages)
            .Select(h => new LlmChatMessage(h.Role, h.Content))
            .ToList();

        LlmUserChatResponse result;
        try
        {
            result = await llmService.UserChatAsync(new LlmUserChatRequest(
                summaries,
                request.Message,
                history,
                string.IsNullOrWhiteSpace(user?.GlobalPreferences) ? null : user.GlobalPreferences
            ));
        }
        catch (Exception ex)
        {
            return StatusCode(502, $"Chat failed: {ex.Message}");
        }

        await usageService.RecordAsync(UserId, "UserChat", result.Usage ?? LlmTokenUsage.Empty);

        // Persist preferences update if the agent signalled one
        if (!string.IsNullOrWhiteSpace(result.PreferencesUpdate) && user is not null)
        {
            user.GlobalPreferences = result.PreferencesUpdate;
            await db.SaveChangesAsync();
        }

        return Ok(new UserChatResponse(result.Reply));
    }

    private async Task<ActionResult<UserChatResponse>> EditAsync(UserChatRequest request)
    {
        var history = (request.History ?? [])
            .Select(h => new LlmChatMessage(h.Role, h.Content))
            .ToList();

        LlmChatResponse result;
        try
        {
            result = await llmService.ChatAsync(new LlmChatRequest(request.Document!, request.Message, history));
        }
        catch (Exception ex)
        {
            return StatusCode(502, $"Chat failed: {ex.Message}");
        }

        await usageService.RecordAsync(UserId, "Chat", result.Usage);

        var proposal = result.Proposal is null
            ? null
            : new ChatProposalDto(result.Proposal.Type, result.Proposal.Description, result.Proposal.PatchJson);

        return Ok(new UserChatResponse(result.Reply, proposal));
    }
}

public record UserChatRequest(string Message, List<ChatMessageDto>? History = null, ProfileDocument? Document = null);
public record UserChatResponse(string Reply, ChatProposalDto? Proposal = null);

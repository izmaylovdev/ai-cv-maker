using System.Security.Claims;
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

        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == UserId);

        var profiles = await db.Profiles
            .Include(p => p.Skills)
            .Where(p => p.UserId == UserId)
            .OrderBy(p => p.Name)
            .ToListAsync();

        var summaries = profiles.Select(p => new LlmProfileSummary(
            p.Name,
            p.Title,
            p.Overview,
            p.Skills.Select(s => s.Name).ToList()
        )).ToList();

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
}

public record UserChatRequest(string Message, List<ChatMessageDto>? History = null);
public record UserChatResponse(string Reply);

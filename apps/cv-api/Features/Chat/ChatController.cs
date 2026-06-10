using System.Security.Claims;
using CvApi.Features.JobProfiles.Dtos;
using CvApi.Infrastructure.ExternalServices.Llm;
using CvApi.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace CvApi.Features.Chat;

[ApiController]
[Route("api/chat")]
[Authorize]
public class ChatController(AppDbContext db, ILlmService llmService) : ControllerBase
{
    private Guid UserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpPost]
    public async Task<ActionResult<UserChatResponse>> Chat(UserChatRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Message))
            return BadRequest("Message is required.");

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
            result = await llmService.UserChatAsync(new LlmUserChatRequest(summaries, request.Message, history));
        }
        catch (Exception ex)
        {
            return StatusCode(502, $"Chat failed: {ex.Message}");
        }

        return Ok(new UserChatResponse(result.Reply));
    }
}

public record UserChatRequest(string Message, List<ChatMessageDto>? History = null);
public record UserChatResponse(string Reply);

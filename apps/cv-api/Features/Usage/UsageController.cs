using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace CvApi.Features.Usage;

[ApiController]
[Route("api/usage")]
[Authorize]
public class UsageController(UsageService usageService) : ControllerBase
{
    private Guid UserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpGet]
    public async Task<MyUsageDto> GetMyUsage()
    {
        var summary = await usageService.GetUserSummaryAsync(UserId);
        var limit = await usageService.GetEffectiveLimitAsync();
        return new MyUsageDto(summary.PromptTokens, summary.CompletionTokens, summary.EstimatedCostUsd, limit, summary.CacheReadTokens, summary.CacheWriteTokens);
    }
}

public record MyUsageDto(int PromptTokens, int CompletionTokens, decimal EstimatedCostUsd, decimal LimitUsd, int CacheReadTokens = 0, int CacheWriteTokens = 0);

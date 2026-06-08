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
    public async Task<UserUsageSummaryDto> GetMyUsage()
        => await usageService.GetUserSummaryAsync(UserId);
}

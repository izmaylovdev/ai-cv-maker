using CvApi.Features.Usage;
using Microsoft.AspNetCore.Mvc;

namespace CvApi.Features.Admin;

/// <summary>
/// Service-to-service endpoints for admin-api to read and update the global
/// per-user LLM spending limit (US-AI-7). API-key auth (ADR-0005), not user JWT.
/// </summary>
[ApiController]
[Route("api/admin/usage-limit")]
[ServiceFilter(typeof(AdminApiKeyFilter))]
public class AdminUsageLimitController(UsageService usageService) : ControllerBase
{
    [HttpGet]
    public async Task<UsageLimitDto> Get()
        => new(await usageService.GetEffectiveLimitAsync());

    [HttpPut]
    public async Task<ActionResult<UsageLimitDto>> Put(UsageLimitDto request)
    {
        if (request.MaxCostUsd <= 0)
            return BadRequest("maxCostUsd must be greater than zero.");

        await usageService.SetLimitAsync(request.MaxCostUsd);
        return Ok(new UsageLimitDto(await usageService.GetEffectiveLimitAsync()));
    }
}

public record UsageLimitDto(decimal MaxCostUsd);

using System.Security.Claims;
using CvApi.Domain.Repositories;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace CvApi.Features.Settings;

[ApiController]
[Route("api/settings")]
[Authorize]
public class SettingsController(IUserRepository users) : ControllerBase
{
    private Guid UserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpGet("preferences")]
    public async Task<ActionResult<PreferencesDto>> Get()
    {
        var user = await users.GetByIdAsync(UserId);
        if (user is null) return NotFound();
        return Ok(new PreferencesDto(user.GlobalPreferences));
    }

    [HttpPut("preferences")]
    public async Task<ActionResult<PreferencesDto>> Put(UpdatePreferencesRequest request)
    {
        var user = await users.GetByIdAsync(UserId);
        if (user is null) return NotFound();
        user.GlobalPreferences = request.GlobalPreferences;
        await users.UpdateAsync(user);
        return Ok(new PreferencesDto(user.GlobalPreferences));
    }
}

public record PreferencesDto(string? GlobalPreferences);
public record UpdatePreferencesRequest(string? GlobalPreferences);

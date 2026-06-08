using System.Security.Claims;
using CvApi.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace CvApi.Features.Settings;

[ApiController]
[Route("api/settings")]
[Authorize]
public class SettingsController(AppDbContext db) : ControllerBase
{
    private Guid UserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpGet("preferences")]
    public async Task<ActionResult<PreferencesDto>> Get()
    {
        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == UserId);
        if (user is null) return NotFound();
        return Ok(new PreferencesDto(user.GlobalPreferences));
    }

    [HttpPut("preferences")]
    public async Task<ActionResult<PreferencesDto>> Put(UpdatePreferencesRequest request)
    {
        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == UserId);
        if (user is null) return NotFound();
        user.GlobalPreferences = request.GlobalPreferences;
        await db.SaveChangesAsync();
        return Ok(new PreferencesDto(user.GlobalPreferences));
    }
}

public record PreferencesDto(string? GlobalPreferences);
public record UpdatePreferencesRequest(string? GlobalPreferences);

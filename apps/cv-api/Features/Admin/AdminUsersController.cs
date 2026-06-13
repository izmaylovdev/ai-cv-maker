using Microsoft.AspNetCore.Mvc;

namespace CvApi.Features.Admin;

/// <summary>
/// Service-to-service endpoints for admin-api (ADR-0005). Authenticated by the
/// shared API key (<see cref="AdminApiKeyFilter"/>), not the user JWT scheme.
/// </summary>
[ApiController]
[Route("api/admin")]
[ServiceFilter(typeof(AdminApiKeyFilter))]
public class AdminUsersController(AdminUsersService adminUsersService) : ControllerBase
{
    [HttpGet("users")]
    public async Task<List<AdminUserDto>> GetUsers(CancellationToken cancellationToken)
        => await adminUsersService.GetUsersAsync(cancellationToken);
}

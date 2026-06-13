using CvApi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace CvApi.Features.Admin;

/// <summary>
/// Serves the registered-users list consumed by admin-api (ADR-0005). This is
/// the single owner of the Users/Profiles read that admin-api used to run as raw
/// SQL against the main DB — keeping it here means a migration that reshapes the
/// entities updates this query in the same change.
/// </summary>
public class AdminUsersService(AppDbContext db)
{
    public async Task<List<AdminUserDto>> GetUsersAsync(CancellationToken cancellationToken = default)
    {
        return await db.Users
            .OrderByDescending(u => u.CreatedAt)
            .Select(u => new AdminUserDto(
                u.Id,
                u.Email,
                u.GoogleId,
                u.CreatedAt,
                u.Profiles.Count))
            .ToListAsync(cancellationToken);
    }
}

public record AdminUserDto(
    Guid Id,
    string Email,
    string? GoogleId,
    DateTime CreatedAt,
    int ProfileCount);

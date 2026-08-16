using CvApi.Domain.Repositories;

namespace CvApi.Features.Admin;

/// <summary>
/// Serves the registered-users list consumed by admin-api (ADR-0005). This is
/// the single owner of the Users/Profiles read that admin-api used to run as raw
/// SQL against the main DB — keeping it here means a migration that reshapes the
/// entities updates this query in the same change.
/// </summary>
public class AdminUsersService(IUserRepository users, IProfileRepository profiles)
{
    public async Task<List<AdminUserDto>> GetUsersAsync(CancellationToken cancellationToken = default)
    {
        // The profile count was a navigation-property count in EF. Firestore
        // has no navigations, so it is a separate aggregation keyed by user id.
        var all = await users.ListAllAsync(cancellationToken);
        var counts = await profiles.CountByUserAsync(
            all.Select(u => u.Id).ToList(), cancellationToken);

        return all
            .OrderByDescending(u => u.CreatedAt)
            .Select(u => new AdminUserDto(
                u.Id,
                u.Email,
                u.GoogleId,
                u.CreatedAt,
                counts.TryGetValue(u.Id, out var c) ? c : 0))
            .ToList();
    }
}

public record AdminUserDto(
    Guid Id,
    string Email,
    string? GoogleId,
    DateTime CreatedAt,
    int ProfileCount);

namespace CvApi.Domain.Entities;

/// <summary>
/// Per-user billing balance (US-AI-14). One row per user, created on demand.
/// <see cref="AllowanceUsd"/> is the user's cumulative AI spend allowance; when
/// no row exists the effective allowance falls back to the billing default or
/// the §9 admin-configurable global limit.
/// </summary>
public class BillingAccount
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public decimal AllowanceUsd { get; set; }
    public string Currency { get; set; } = "USD";
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

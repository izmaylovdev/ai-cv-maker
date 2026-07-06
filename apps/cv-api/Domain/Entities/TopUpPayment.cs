namespace CvApi.Domain.Entities;

/// <summary>
/// Lifecycle states of a <see cref="TopUpPayment"/> (US-BILL-1). Stored as
/// strings; <c>Paid</c> and <c>Failed</c> are terminal and never regress.
/// </summary>
public static class TopUpStatus
{
    public const string Pending = "Pending";
    public const string Paid = "Paid";
    public const string Failed = "Failed";
}

/// <summary>
/// A balance top-up attempt (US-BILL-1). Created <c>Pending</c> when the user
/// starts a payment; a provider webhook (or the fake-pay flow in dev) moves it
/// to <c>Paid</c> — crediting <see cref="BillingAccount.AllowanceUsd"/> exactly
/// once — or <c>Failed</c>.
/// </summary>
public class TopUpPayment
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }

    /// <summary>Fixed top-up amount in USD: one of 5, 10, 20.</summary>
    public decimal AmountUsd { get; set; }

    /// <summary>Channel name: "stripe" | "monobank" (or "fake-" prefixed in dev).</summary>
    public string Channel { get; set; } = string.Empty;

    /// <summary>One of <see cref="TopUpStatus"/>.</summary>
    public string Status { get; set; } = TopUpStatus.Pending;

    /// <summary>Provider-side id: Stripe session id / Monobank invoiceId / fake id.</summary>
    public string? ExternalId { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

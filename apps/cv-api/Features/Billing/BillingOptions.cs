namespace CvApi.Features.Billing;

/// <summary>
/// Billing configuration (US-AI-14). When <see cref="DefaultAllowanceUsd"/> is
/// null (the default), users without a <c>BillingAccount</c> row fall back to
/// the §9 admin-configurable global limit, preserving US-AI-7 behavior.
/// </summary>
public class BillingOptions
{
    public const string SectionName = "Billing";

    /// <summary>
    /// Default per-user AI spend allowance (USD) applied when a user has no
    /// <c>BillingAccount</c> row. Null => fall back to the global usage limit.
    /// </summary>
    public decimal? DefaultAllowanceUsd { get; set; }
}

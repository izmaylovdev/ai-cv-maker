using CvApi.Domain.Entities;
using CvApi.Features.Billing;
using CvApi.Infrastructure.ExternalServices.Llm;
using CvApi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace CvApi.Features.Usage;

public class LlmPricingModel
{
    public decimal PromptCostPer1M { get; set; }
    public decimal CompletionCostPer1M { get; set; }
}

public class LlmPricingOptions
{
    public const string SectionName = "LlmPricing";
    public Dictionary<string, LlmPricingModel> Models { get; set; } = new();
}

public class UsageLimitOptions
{
    public const string SectionName = "UsageLimit";

    /// <summary>
    /// Fallback per-user cumulative cost cap (USD) used when no
    /// <c>LlmUsageLimitUsd</c> row is present in the database.
    /// </summary>
    public decimal MaxCostUsdPerUser { get; set; } = 0.50m;
}

/// <summary>
/// Thrown before an LLM call when the requesting user has already accrued
/// estimated cost at or above their effective billing allowance (US-AI-14,
/// extends US-AI-7). Mapped to HTTP 402 by <c>UsageLimitExceptionHandler</c>.
/// </summary>
public class UsageLimitExceededException(decimal limitUsd)
    : Exception(FormattableString.Invariant(
        $"Your billing balance is exhausted — you've used your ${limitUsd:0.00} AI allowance."))
{
    public decimal LimitUsd { get; } = limitUsd;
}

public class UsageService(
    AppDbContext db,
    IOptions<LlmPricingOptions> pricing,
    IOptions<UsageLimitOptions> limitOptions,
    IOptions<BillingOptions> billingOptions)
{
    /// <summary>DB key under which the admin-configurable limit is stored.</summary>
    public const string LimitSettingKey = "LlmUsageLimitUsd";

    public async Task RecordAsync(Guid? userId, string operation, LlmTokenUsage usage)
    {
        if (usage.PromptTokens == 0 && usage.CompletionTokens == 0)
            return;

        db.LlmUsages.Add(new LlmUsage
        {
            UserId = userId,
            Operation = operation,
            PromptTokens = usage.PromptTokens,
            CompletionTokens = usage.CompletionTokens,
            ModelName = usage.ModelName,
        });
        await db.SaveChangesAsync();
    }

    public async Task<UserUsageSummaryDto> GetUserSummaryAsync(Guid userId)
    {
        var rows = await db.LlmUsages
            .Where(u => u.UserId == userId)
            .ToListAsync();

        return Summarize(rows);
    }

    /// <summary>
    /// Effective per-user cost cap: the DB override (<see cref="LimitSettingKey"/>)
    /// if present and parseable, otherwise the appsettings default.
    /// </summary>
    public async Task<decimal> GetEffectiveLimitAsync()
    {
        var setting = await db.AppSettings.FirstOrDefaultAsync(s => s.Key == LimitSettingKey);
        if (setting is not null
            && decimal.TryParse(setting.Value, System.Globalization.NumberStyles.Number,
                System.Globalization.CultureInfo.InvariantCulture, out var stored))
        {
            return stored;
        }
        return limitOptions.Value.MaxCostUsdPerUser;
    }

    /// <summary>Persists a new global limit. Rejects non-positive values.</summary>
    public async Task SetLimitAsync(decimal maxCostUsd)
    {
        if (maxCostUsd <= 0)
            throw new ArgumentOutOfRangeException(nameof(maxCostUsd), "Limit must be greater than zero.");

        var setting = await db.AppSettings.FirstOrDefaultAsync(s => s.Key == LimitSettingKey);
        var value = maxCostUsd.ToString(System.Globalization.CultureInfo.InvariantCulture);
        if (setting is null)
        {
            db.AppSettings.Add(new AppSetting { Key = LimitSettingKey, Value = value, UpdatedAt = DateTime.UtcNow });
        }
        else
        {
            setting.Value = value;
            setting.UpdatedAt = DateTime.UtcNow;
        }
        await db.SaveChangesAsync();
    }

    /// <summary>
    /// Effective per-user billing allowance (US-AI-14): the user's
    /// <c>BillingAccount.AllowanceUsd</c> if a row exists; otherwise the
    /// configured billing default when non-null; otherwise the §9
    /// admin-configurable global limit (preserves US-AI-7 behavior).
    /// </summary>
    public async Task<decimal> GetEffectiveAllowanceAsync(Guid userId)
    {
        var account = await db.BillingAccounts.FirstOrDefaultAsync(b => b.UserId == userId);
        if (account is not null)
            return account.AllowanceUsd;

        if (billingOptions.Value.DefaultAllowanceUsd is decimal configuredDefault)
            return configuredDefault;

        return await GetEffectiveLimitAsync();
    }

    /// <summary>
    /// Guard called before every LLM operation. Throws
    /// <see cref="UsageLimitExceededException"/> when the user's accrued cost has
    /// reached their effective billing allowance. System calls (null user) are exempt.
    /// </summary>
    public async Task EnsureWithinLimitAsync(Guid? userId)
    {
        if (userId is null)
            return;

        var accrued = (await GetUserSummaryAsync(userId.Value)).EstimatedCostUsd;
        var allowance = await GetEffectiveAllowanceAsync(userId.Value);
        if (accrued >= allowance)
            throw new UsageLimitExceededException(allowance);
    }

    /// <summary>
    /// Per-user billing summary (US-AI-14, extended by US-BILL-1): allowance,
    /// spend, remaining balance (floored at zero), currency, token totals, and
    /// the stored payment country (null when never asked).
    /// </summary>
    public async Task<BillingSummaryDto> GetBillingSummaryAsync(Guid userId)
    {
        var summary = await GetUserSummaryAsync(userId);
        var allowance = await GetEffectiveAllowanceAsync(userId);
        var balance = Math.Max(0, allowance - summary.EstimatedCostUsd);
        var country = await db.Users
            .Where(u => u.Id == userId)
            .Select(u => u.Country)
            .FirstOrDefaultAsync();
        return new BillingSummaryDto(
            allowance,
            summary.EstimatedCostUsd,
            balance,
            "USD",
            summary.PromptTokens,
            summary.CompletionTokens,
            country);
    }

    public async Task<List<AdminUsageSummaryDto>> GetAllUserSummariesAsync()
    {
        var rows = await db.LlmUsages
            .Where(u => u.UserId != null)
            .Join(db.Users, u => u.UserId, usr => usr.Id, (u, usr) => new { u, usr.Email })
            .ToListAsync();

        return rows
            .GroupBy(r => new { r.u.UserId, r.Email })
            .Select(g =>
            {
                var summary = Summarize(g.Select(r => r.u).ToList());
                return new AdminUsageSummaryDto(g.Key.UserId!.Value, g.Key.Email, summary.PromptTokens, summary.CompletionTokens, summary.EstimatedCostUsd);
            })
            .OrderByDescending(s => s.EstimatedCostUsd)
            .ToList();
    }

    private UserUsageSummaryDto Summarize(IEnumerable<LlmUsage> rows)
    {
        var models = pricing.Value.Models;
        decimal totalCost = 0;
        int totalPrompt = 0, totalCompletion = 0;

        foreach (var row in rows)
        {
            totalPrompt += row.PromptTokens;
            totalCompletion += row.CompletionTokens;

            var key = models.ContainsKey(row.ModelName) ? row.ModelName : "default";
            if (models.TryGetValue(key, out var model))
            {
                totalCost += (decimal)row.PromptTokens / 1_000_000m * model.PromptCostPer1M
                           + (decimal)row.CompletionTokens / 1_000_000m * model.CompletionCostPer1M;
            }
        }

        return new UserUsageSummaryDto(totalPrompt, totalCompletion, Math.Round(totalCost, 6));
    }
}

public record UserUsageSummaryDto(int PromptTokens, int CompletionTokens, decimal EstimatedCostUsd);
public record AdminUsageSummaryDto(Guid UserId, string Email, int PromptTokens, int CompletionTokens, decimal EstimatedCostUsd);
public record BillingSummaryDto(decimal AllowanceUsd, decimal SpentUsd, decimal BalanceUsd, string Currency, int PromptTokens, int CompletionTokens, string? Country = null);

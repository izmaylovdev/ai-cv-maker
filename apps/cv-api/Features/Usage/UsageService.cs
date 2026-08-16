using CvApi.Domain.Entities;
using CvApi.Domain.Repositories;
using CvApi.Features.Billing;
using CvApi.Infrastructure.ExternalServices.Llm;
using Microsoft.Extensions.Options;

namespace CvApi.Features.Usage;

public class LlmPricingModel
{
    public decimal PromptCostPer1M { get; set; }
    public decimal CompletionCostPer1M { get; set; }

    /// <summary>
    /// Explicit cache pricing (US-AI-17). When null, fallback multipliers on
    /// <see cref="PromptCostPer1M"/> apply: 0.1x for reads, 1.25x for writes.
    /// </summary>
    public decimal? CacheReadCostPer1M { get; set; }
    public decimal? CacheWriteCostPer1M { get; set; }
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
    ILlmUsageRepository usageRepo,
    IAppSettingRepository settingRepo,
    IBillingAccountRepository billingAccounts,
    IUserRepository users,
    IOptions<LlmPricingOptions> pricing,
    IOptions<UsageLimitOptions> limitOptions,
    IOptions<BillingOptions> billingOptions)
{
    /// <summary>DB key under which the admin-configurable limit is stored.</summary>
    public const string LimitSettingKey = "LlmUsageLimitUsd";

    public async Task RecordAsync(Guid? userId, string operation, LlmTokenUsage usage)
    {
        if (usage.PromptTokens == 0 && usage.CompletionTokens == 0
            && usage.CacheReadTokens == 0 && usage.CacheWriteTokens == 0)
            return;

        await usageRepo.AddAsync(new LlmUsage
        {
            UserId = userId,
            Operation = operation,
            PromptTokens = usage.PromptTokens,
            CompletionTokens = usage.CompletionTokens,
            CacheReadTokens = usage.CacheReadTokens,
            CacheWriteTokens = usage.CacheWriteTokens,
            ModelName = usage.ModelName,
        });
    }

    public async Task<UserUsageSummaryDto> GetUserSummaryAsync(Guid userId)
    {
        var rows = await usageRepo.ListByUserAsync(userId);
        return Summarize(rows);
    }

    /// <summary>
    /// Effective per-user cost cap: the DB override (<see cref="LimitSettingKey"/>)
    /// if present and parseable, otherwise the appsettings default.
    /// </summary>
    public async Task<decimal> GetEffectiveLimitAsync()
    {
        var setting = await settingRepo.GetAsync(LimitSettingKey);
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

        var value = maxCostUsd.ToString(System.Globalization.CultureInfo.InvariantCulture);
        await settingRepo.UpsertAsync(LimitSettingKey, value);
    }

    /// <summary>
    /// Effective per-user billing allowance (US-AI-14): the user's
    /// <c>BillingAccount.AllowanceUsd</c> if a row exists; otherwise the
    /// configured billing default when non-null; otherwise the §9
    /// admin-configurable global limit (preserves US-AI-7 behavior).
    /// </summary>
    public async Task<decimal> GetEffectiveAllowanceAsync(Guid userId)
    {
        var account = await billingAccounts.GetByUserAsync(userId);
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
        var country = (await users.GetByIdAsync(userId))?.Country;
        return new BillingSummaryDto(
            allowance,
            summary.EstimatedCostUsd,
            balance,
            "USD",
            summary.PromptTokens,
            summary.CompletionTokens,
            country,
            summary.CacheReadTokens,
            summary.CacheWriteTokens);
    }

    public async Task<List<AdminUsageSummaryDto>> GetAllUserSummariesAsync()
    {
        // Firestore has no joins, so the email lookup that used to be a SQL
        // JOIN is now a second read plus an in-memory match. Usage rows whose
        // user no longer exists are dropped, matching the inner join's behaviour.
        var rows = await usageRepo.ListAllAttributedAsync();
        var emailById = (await users.ListAllAsync()).ToDictionary(u => u.Id, u => u.Email);

        return rows
            .GroupBy(r => r.UserId!.Value)
            .Where(g => emailById.ContainsKey(g.Key))
            .Select(g =>
            {
                var summary = Summarize(g.ToList());
                return new AdminUsageSummaryDto(g.Key, emailById[g.Key], summary.PromptTokens, summary.CompletionTokens, summary.EstimatedCostUsd, summary.CacheReadTokens, summary.CacheWriteTokens);
            })
            .OrderByDescending(s => s.EstimatedCostUsd)
            .ToList();
    }

    private UserUsageSummaryDto Summarize(IEnumerable<LlmUsage> rows)
    {
        var models = pricing.Value.Models;
        decimal totalCost = 0;
        int totalPrompt = 0, totalCompletion = 0, totalCacheRead = 0, totalCacheWrite = 0;

        foreach (var row in rows)
        {
            totalPrompt += row.PromptTokens;
            totalCompletion += row.CompletionTokens;
            totalCacheRead += row.CacheReadTokens;
            totalCacheWrite += row.CacheWriteTokens;

            var key = models.ContainsKey(row.ModelName) ? row.ModelName : "default";
            if (models.TryGetValue(key, out var model))
            {
                // Cache tokens are additional to PromptTokens (providers report
                // input_tokens excluding cached content). Fallback rates per
                // F-AI-17.7: reads at 0.1x, writes at 1.25x the prompt rate.
                var cacheReadCost = model.CacheReadCostPer1M ?? 0.1m * model.PromptCostPer1M;
                var cacheWriteCost = model.CacheWriteCostPer1M ?? 1.25m * model.PromptCostPer1M;
                totalCost += (decimal)row.PromptTokens / 1_000_000m * model.PromptCostPer1M
                           + (decimal)row.CompletionTokens / 1_000_000m * model.CompletionCostPer1M
                           + (decimal)row.CacheReadTokens / 1_000_000m * cacheReadCost
                           + (decimal)row.CacheWriteTokens / 1_000_000m * cacheWriteCost;
            }
        }

        return new UserUsageSummaryDto(totalPrompt, totalCompletion, Math.Round(totalCost, 6), totalCacheRead, totalCacheWrite);
    }
}

public record UserUsageSummaryDto(int PromptTokens, int CompletionTokens, decimal EstimatedCostUsd, int CacheReadTokens = 0, int CacheWriteTokens = 0);
public record AdminUsageSummaryDto(Guid UserId, string Email, int PromptTokens, int CompletionTokens, decimal EstimatedCostUsd, int CacheReadTokens = 0, int CacheWriteTokens = 0);
public record BillingSummaryDto(decimal AllowanceUsd, decimal SpentUsd, decimal BalanceUsd, string Currency, int PromptTokens, int CompletionTokens, string? Country = null, int CacheReadTokens = 0, int CacheWriteTokens = 0);

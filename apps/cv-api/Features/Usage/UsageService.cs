using CvApi.Domain.Entities;
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

public class UsageService(AppDbContext db, IOptions<LlmPricingOptions> pricing)
{
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

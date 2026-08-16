using CvApi.Domain.Entities;
using CvApi.Features.Billing;
using CvApi.Features.Usage;
using CvApi.Infrastructure.ExternalServices.Llm;
using CvApi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace CvApi.Tests;

// US-AI-17 — discounted cached rate for repeated AI prompt content.
// Spec §17 (doc/web-client/specs/ai-enhancement.md):
//   F-AI-17.6 — LlmTokenUsage / LlmUsage carry CacheReadTokens / CacheWriteTokens;
//               RecordAsync skips only rows where ALL FOUR token counts are zero.
//   F-AI-17.7 — Summarize prices cache reads/writes: explicit CacheReadCostPer1M /
//               CacheWriteCostPer1M when configured, otherwise the fallback
//               multipliers 0.1x / 1.25x PromptCostPer1M. Zero-cache rows price
//               exactly as today.
//   F-AI-17.8 — usage summary DTOs expose total CacheReadTokens / CacheWriteTokens;
//               allowance checks keep using EstimatedCostUsd, which now reflects
//               the discounted cache pricing.
// Service-level tests mirroring UsageLimitTests / BillingTests: in-memory
// InMemoryStore, UsageService constructed directly with IOptions.
public class UsageCacheTokensTests
{
    private static InMemoryStore CreateDb() => new();

    // Pricing:
    //   "default" — $3 / 1M prompt, $15 / 1M completion, NO explicit cache rates
    //               (fallbacks apply: read = 0.1 x $3 = $0.30/1M, write = 1.25 x $3 = $3.75/1M).
    //   "cached"  — same base rates plus EXPLICIT cache rates ($0.50/1M read, $4/1M write).
    private static IOptions<LlmPricingOptions> Pricing()
        => Options.Create(new LlmPricingOptions
        {
            Models = new()
            {
                ["default"] = new LlmPricingModel { PromptCostPer1M = 3.0m, CompletionCostPer1M = 15.0m },
                ["cached"] = new LlmPricingModel
                {
                    PromptCostPer1M = 3.0m,
                    CompletionCostPer1M = 15.0m,
                    CacheReadCostPer1M = 0.50m,
                    CacheWriteCostPer1M = 4.0m,
                },
            },
        });

    private static UsageService Service(InMemoryStore db)
        => new(db, db, db, db, Pricing(),
            Options.Create(new UsageLimitOptions { MaxCostUsdPerUser = 100m }),
            Options.Create(new BillingOptions()));

    private static LlmUsage Row(
        Guid userId,
        int promptTokens,
        int completionTokens,
        int cacheReadTokens = 0,
        int cacheWriteTokens = 0,
        string modelName = "default")
        => new()
        {
            UserId = userId,
            Operation = "Chat",
            PromptTokens = promptTokens,
            CompletionTokens = completionTokens,
            CacheReadTokens = cacheReadTokens,
            CacheWriteTokens = cacheWriteTokens,
            ModelName = modelName,
        };

    // ---- F-AI-17.6 — persistence of the cache token counts -------------------

    [Fact]
    public async Task RecordAsync_PersistsCacheTokenCounts()
    {
        var db = CreateDb();
        var userId = Guid.NewGuid();

        await Service(db).RecordAsync(userId, "Chat",
            new LlmTokenUsage(100, 20, "default", CacheReadTokens: 300, CacheWriteTokens: 50));

        var row = Assert.Single(db.LlmUsages);
        Assert.Equal(100, row.PromptTokens);
        Assert.Equal(20, row.CompletionTokens);
        Assert.Equal(300, row.CacheReadTokens);
        Assert.Equal(50, row.CacheWriteTokens);
    }

    [Fact]
    public async Task RecordAsync_CacheOnlyUsage_IsStillRecorded()
    {
        var db = CreateDb();
        var userId = Guid.NewGuid();

        // prompt = 0, completion = 0, but cache reads > 0 — a follow-up turn served
        // almost entirely from cache must still be recorded (and billed).
        await Service(db).RecordAsync(userId, "Chat",
            new LlmTokenUsage(0, 0, "default", CacheReadTokens: 500));

        var row = Assert.Single(db.LlmUsages);
        Assert.Equal(500, row.CacheReadTokens);
    }

    [Fact]
    public async Task RecordAsync_AllFourTokenCountsZero_IsSkipped()
    {
        var db = CreateDb();
        var userId = Guid.NewGuid();

        await Service(db).RecordAsync(userId, "Chat", new LlmTokenUsage(0, 0, "default"));

        Assert.Empty(db.LlmUsages);
    }

    // ---- F-AI-17.7 — cache-aware pricing --------------------------------------

    [Fact]
    public async Task Summary_PricesCacheTokens_WithFallbackMultipliers_WhenNotConfigured()
    {
        var db = CreateDb();
        var userId = Guid.NewGuid();
        // "default" has no explicit cache rates:
        //   1M prompt x $3 + 1M cache-read x (0.1 x $3) + 1M cache-write x (1.25 x $3)
        //   = 3.00 + 0.30 + 3.75 = 7.05
        db.LlmUsages.Add(Row(userId, 1_000_000, 0, cacheReadTokens: 1_000_000, cacheWriteTokens: 1_000_000));
        await db.SaveChangesAsync();

        var summary = await Service(db).GetUserSummaryAsync(userId);

        Assert.Equal(7.05m, summary.EstimatedCostUsd);
    }

    [Fact]
    public async Task Summary_PricesCacheTokens_WithExplicitRates_WhenConfigured()
    {
        var db = CreateDb();
        var userId = Guid.NewGuid();
        // "cached" has explicit rates: 1M reads x $0.50 + 1M writes x $4 = 4.50
        db.LlmUsages.Add(Row(userId, 0, 0, cacheReadTokens: 1_000_000, cacheWriteTokens: 1_000_000, modelName: "cached"));
        await db.SaveChangesAsync();

        var summary = await Service(db).GetUserSummaryAsync(userId);

        Assert.Equal(4.50m, summary.EstimatedCostUsd);
    }

    [Fact]
    public async Task Summary_ZeroCacheCounts_PricesExactlyAsToday()
    {
        var db = CreateDb();
        var userId = Guid.NewGuid();
        // 1M prompt x $3 + 1M completion x $15 = 18.00 — unchanged by US-AI-17.
        db.LlmUsages.Add(Row(userId, 1_000_000, 1_000_000));
        await db.SaveChangesAsync();

        var summary = await Service(db).GetUserSummaryAsync(userId);

        Assert.Equal(18.00m, summary.EstimatedCostUsd);
    }

    // ---- F-AI-17.8 — DTOs expose the cache token totals ------------------------

    [Fact]
    public async Task UserSummary_ExposesCacheTokenTotals()
    {
        var db = CreateDb();
        var userId = Guid.NewGuid();
        db.LlmUsages.Add(Row(userId, 100, 20, cacheReadTokens: 300, cacheWriteTokens: 50));
        db.LlmUsages.Add(Row(userId, 40, 5, cacheReadTokens: 200, cacheWriteTokens: 25));
        await db.SaveChangesAsync();

        var summary = await Service(db).GetUserSummaryAsync(userId);

        Assert.Equal(140, summary.PromptTokens);
        Assert.Equal(25, summary.CompletionTokens);
        Assert.Equal(500, summary.CacheReadTokens);
        Assert.Equal(75, summary.CacheWriteTokens);
    }

    [Fact]
    public async Task BillingSummary_ExposesCacheTokenTotals()
    {
        var db = CreateDb();
        var userId = Guid.NewGuid();
        db.LlmUsages.Add(Row(userId, 100, 20, cacheReadTokens: 300, cacheWriteTokens: 50));
        await db.SaveChangesAsync();

        var billing = await Service(db).GetBillingSummaryAsync(userId);

        Assert.Equal(300, billing.CacheReadTokens);
        Assert.Equal(50, billing.CacheWriteTokens);
    }

    [Fact]
    public async Task AdminSummaries_ExposeCacheTokenTotals()
    {
        var db = CreateDb();
        var user = new User { Email = "cache@example.com" };
        db.Users.Add(user);
        db.LlmUsages.Add(Row(user.Id, 100, 20, cacheReadTokens: 300, cacheWriteTokens: 50));
        db.LlmUsages.Add(Row(user.Id, 40, 5, cacheReadTokens: 200, cacheWriteTokens: 25));
        await db.SaveChangesAsync();

        var summaries = await Service(db).GetAllUserSummariesAsync();

        var summary = Assert.Single(summaries);
        Assert.Equal(500, summary.CacheReadTokens);
        Assert.Equal(75, summary.CacheWriteTokens);
    }

    // MyUsageDto test removed: the Usage page and its GET /api/usage endpoint were
    // dropped in favor of Billing (PR #7); the calling user's cache totals are
    // covered by the BillingSummaryDto test above (F-AI-17.8).

    // ---- Acceptance: allowance depletes at the discounted rate -----------------

    [Fact]
    public async Task CachedFollowUpTurn_CostsMeasurablyLessThanFirstTurnEquivalent()
    {
        var db = CreateDb();
        var firstTurnUser = Guid.NewGuid();
        var followUpUser = Guid.NewGuid();

        // Same total input size (100k tokens) + same completion; the follow-up
        // turn is served 90% from cache.
        db.LlmUsages.Add(Row(firstTurnUser, 100_000, 1_000));
        db.LlmUsages.Add(Row(followUpUser, 10_000, 1_000, cacheReadTokens: 90_000));
        await db.SaveChangesAsync();

        var svc = Service(db);
        var firstTurnCost = (await svc.GetUserSummaryAsync(firstTurnUser)).EstimatedCostUsd;
        var followUpCost = (await svc.GetUserSummaryAsync(followUpUser)).EstimatedCostUsd;

        // first turn: 0.1M x $3 + 0.001M x $15                     = 0.315
        // follow-up:  0.01M x $3 + 0.09M x $0.30 + 0.001M x $15    = 0.072
        Assert.Equal(0.315m, firstTurnCost);
        Assert.Equal(0.072m, followUpCost);
        Assert.True(followUpCost < firstTurnCost,
            "an identical follow-up turn must deplete the allowance measurably less than its first-turn equivalent");
    }
}

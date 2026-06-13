using CvApi.Domain.Entities;
using CvApi.Features.Usage;
using CvApi.Infrastructure.ExternalServices.Llm;
using CvApi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace CvApi.Tests;

public class UsageLimitTests
{
    private static AppDbContext CreateDb()
    {
        var opts = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new AppDbContext(opts);
    }

    // Pricing: default model = $3 / 1M prompt, $15 / 1M completion.
    private static IOptions<LlmPricingOptions> Pricing()
        => Options.Create(new LlmPricingOptions
        {
            Models = new()
            {
                ["default"] = new LlmPricingModel { PromptCostPer1M = 3.0m, CompletionCostPer1M = 15.0m },
            },
        });

    private static IOptions<UsageLimitOptions> Limit(decimal max)
        => Options.Create(new UsageLimitOptions { MaxCostUsdPerUser = max });

    private static UsageService Service(AppDbContext db, decimal limit = 0.50m)
        => new(db, Pricing(), Limit(limit));

    // 1M completion tokens at $15/1M = $15.00 of accrued cost.
    private static LlmUsage Usage(Guid userId, int completionTokens)
        => new() { UserId = userId, Operation = "Generate", PromptTokens = 0, CompletionTokens = completionTokens, ModelName = "default" };

    [Fact]
    public async Task EnsureWithinLimit_UnderLimit_DoesNotThrow()
    {
        await using var db = CreateDb();
        var userId = Guid.NewGuid();
        // 10_000 completion tokens => $0.15, under the $0.50 cap.
        db.LlmUsages.Add(Usage(userId, 10_000));
        await db.SaveChangesAsync();

        await Service(db, 0.50m).EnsureWithinLimitAsync(userId); // no throw
    }

    [Fact]
    public async Task EnsureWithinLimit_AtLimit_Throws()
    {
        await using var db = CreateDb();
        var userId = Guid.NewGuid();
        // 33_333 completion tokens => $0.499995; add prompt to push to exactly >= 0.50.
        // 34_000 completion tokens => $0.51, >= cap.
        db.LlmUsages.Add(Usage(userId, 34_000));
        await db.SaveChangesAsync();

        await Assert.ThrowsAsync<UsageLimitExceededException>(
            () => Service(db, 0.50m).EnsureWithinLimitAsync(userId));
    }

    [Fact]
    public async Task EnsureWithinLimit_NullUser_IsExempt()
    {
        await using var db = CreateDb();
        // System call (no user) must never be blocked.
        await Service(db, 0.50m).EnsureWithinLimitAsync(null); // no throw
    }

    [Fact]
    public async Task GetEffectiveLimit_FallsBackToOptions_WhenNoDbValue()
    {
        await using var db = CreateDb();
        var limit = await Service(db, 0.50m).GetEffectiveLimitAsync();
        Assert.Equal(0.50m, limit);
    }

    [Fact]
    public async Task SetLimit_ThenGetEffectiveLimit_ReturnsDbValue()
    {
        await using var db = CreateDb();
        var svc = Service(db, 0.50m);

        await svc.SetLimitAsync(2.5m);

        Assert.Equal(2.5m, await svc.GetEffectiveLimitAsync());
    }

    [Fact]
    public async Task DbLimitOverridesOptions_AndIsEnforced()
    {
        await using var db = CreateDb();
        var userId = Guid.NewGuid();
        db.LlmUsages.Add(Usage(userId, 34_000)); // $0.51 accrued
        await db.SaveChangesAsync();

        var svc = Service(db, 0.50m);
        // Raise the limit above accrued cost -> now allowed.
        await svc.SetLimitAsync(1.00m);
        await svc.EnsureWithinLimitAsync(userId); // no throw
    }

    [Fact]
    public async Task SetLimit_RejectsNonPositive()
    {
        await using var db = CreateDb();
        var svc = Service(db, 0.50m);
        await Assert.ThrowsAsync<ArgumentOutOfRangeException>(() => svc.SetLimitAsync(0m));
        await Assert.ThrowsAsync<ArgumentOutOfRangeException>(() => svc.SetLimitAsync(-1m));
    }
}

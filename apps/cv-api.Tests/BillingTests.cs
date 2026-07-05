using CvApi.Domain.Entities;
using CvApi.Features.Billing;
using CvApi.Features.Usage;
using CvApi.Infrastructure.ExternalServices.Llm;
using CvApi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace CvApi.Tests;

// US-AI-14 — per-user billing balance and enforcement against each user's OWN allowance.
// Service-level unit tests mirroring UsageLimitTests: in-memory AppDbContext, UsageService
// constructed directly with IOptions. No WebApplicationFactory.
//
// NOTE FOR THE IMPLEMENTER: once BillingOptions exists, UsageService gains an
// IOptions<BillingOptions> ctor parameter. UsageLimitTests.Service() will need the new
// arg added mechanically so it keeps compiling — do NOT weaken any of its assertions.
public class BillingTests
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

    private static IOptions<BillingOptions> Billing(decimal? defaultAllowance)
        => Options.Create(new BillingOptions { DefaultAllowanceUsd = defaultAllowance });

    // UsageService now takes an IOptions<BillingOptions>. Default: no billing default
    // allowance (null) => allowance falls back to the §9 global limit.
    private static UsageService Service(AppDbContext db, decimal limit = 0.50m, decimal? defaultAllowance = null)
        => new(db, Pricing(), Limit(limit), Billing(defaultAllowance));

    private static LlmUsage Usage(Guid userId, int promptTokens, int completionTokens)
        => new() { UserId = userId, Operation = "Generate", PromptTokens = promptTokens, CompletionTokens = completionTokens, ModelName = "default" };

    private static BillingAccount Account(Guid userId, decimal allowanceUsd)
        => new() { UserId = userId, AllowanceUsd = allowanceUsd, Currency = "USD", UpdatedAt = DateTime.UtcNow };

    // ---- F-AI-14.2 / F-AI-14.3 — summary composition -------------------------

    [Fact]
    public async Task GetBillingSummary_ReturnsAllowanceSpentBalanceTokensAndCurrency()
    {
        await using var db = CreateDb();
        var userId = Guid.NewGuid();
        // 12_000 prompt @ $3/1M = $0.036 ; 3_000 completion @ $15/1M = $0.045 ; spent = $0.081.
        db.LlmUsages.Add(Usage(userId, 12_000, 3_000));
        db.BillingAccounts.Add(Account(userId, 0.50m));
        await db.SaveChangesAsync();

        var summary = await Service(db).GetBillingSummaryAsync(userId);

        Assert.Equal(0.50m, summary.AllowanceUsd);
        Assert.Equal(0.081m, summary.SpentUsd);
        Assert.Equal(0.419m, summary.BalanceUsd); // 0.50 − 0.081
        Assert.Equal("USD", summary.Currency);
        Assert.Equal(12_000, summary.PromptTokens);
        Assert.Equal(3_000, summary.CompletionTokens);
    }

    [Fact]
    public async Task GetBillingSummary_BalanceIsFlooredAtZero_WhenSpentExceedsAllowance()
    {
        await using var db = CreateDb();
        var userId = Guid.NewGuid();
        // 100_000 completion @ $15/1M = $1.50 spent, well over a $0.50 allowance.
        db.LlmUsages.Add(Usage(userId, 0, 100_000));
        db.BillingAccounts.Add(Account(userId, 0.50m));
        await db.SaveChangesAsync();

        var summary = await Service(db).GetBillingSummaryAsync(userId);

        Assert.Equal(0m, summary.BalanceUsd); // never negative
        Assert.True(summary.SpentUsd > summary.AllowanceUsd);
    }

    // ---- F-AI-14.4 (per-user independence) -----------------------------------

    [Fact]
    public async Task GetBillingSummary_IsPerUser_OneUsersSpendDoesNotAffectAnother()
    {
        await using var db = CreateDb();
        var userA = Guid.NewGuid();
        var userB = Guid.NewGuid();
        // A spends; B spends nothing. Both have their own allowance rows.
        db.LlmUsages.Add(Usage(userA, 0, 30_000)); // $0.45
        db.BillingAccounts.Add(Account(userA, 1.00m));
        db.BillingAccounts.Add(Account(userB, 2.00m));
        await db.SaveChangesAsync();

        var svc = Service(db);
        var a = await svc.GetBillingSummaryAsync(userA);
        var b = await svc.GetBillingSummaryAsync(userB);

        Assert.Equal(0.45m, a.SpentUsd);
        Assert.Equal(0.55m, a.BalanceUsd); // 1.00 − 0.45

        Assert.Equal(0m, b.SpentUsd);      // unaffected by A
        Assert.Equal(2.00m, b.AllowanceUsd);
        Assert.Equal(2.00m, b.BalanceUsd);
    }

    // ---- F-AI-14.1 — effective allowance resolution --------------------------

    [Fact]
    public async Task GetEffectiveAllowance_ReturnsBillingAccountValue_WhenRowPresent()
    {
        await using var db = CreateDb();
        var userId = Guid.NewGuid();
        db.BillingAccounts.Add(Account(userId, 3.25m));
        await db.SaveChangesAsync();

        // Row wins over both the billing default and the §9 limit.
        var allowance = await Service(db, limit: 0.50m, defaultAllowance: 0.50m)
            .GetEffectiveAllowanceAsync(userId);

        Assert.Equal(3.25m, allowance);
    }

    [Fact]
    public async Task GetEffectiveAllowance_FallsBackToBillingDefault_WhenNoRowAndDefaultSet()
    {
        await using var db = CreateDb();
        var userId = Guid.NewGuid();

        // No BillingAccount row; BillingOptions.DefaultAllowanceUsd non-null => use it,
        // NOT the §9 global limit.
        var allowance = await Service(db, limit: 5.00m, defaultAllowance: 0.50m)
            .GetEffectiveAllowanceAsync(userId);

        Assert.Equal(0.50m, allowance);
    }

    [Fact]
    public async Task GetEffectiveAllowance_FallsBackToGlobalLimit_WhenNoRowAndDefaultNull()
    {
        await using var db = CreateDb();
        var userId = Guid.NewGuid();

        // No row, DefaultAllowanceUsd null => preserve §9 behavior via GetEffectiveLimitAsync().
        var allowance = await Service(db, limit: 0.75m, defaultAllowance: null)
            .GetEffectiveAllowanceAsync(userId);

        Assert.Equal(0.75m, allowance);
    }

    // ---- F-AI-14.4 / F-AI-14.5 — per-user enforcement ------------------------

    [Fact]
    public async Task EnsureWithinLimit_Throws_WhenAccruedReachesUsersOwnAllowance()
    {
        await using var db = CreateDb();
        var userId = Guid.NewGuid();
        // 34_000 completion @ $15/1M = $0.51 accrued, >= the user's own $0.50 allowance.
        db.LlmUsages.Add(Usage(userId, 0, 34_000));
        db.BillingAccounts.Add(Account(userId, 0.50m));
        await db.SaveChangesAsync();

        await Assert.ThrowsAsync<UsageLimitExceededException>(
            () => Service(db, defaultAllowance: 0.50m).EnsureWithinLimitAsync(userId));
    }

    [Fact]
    public async Task EnsureWithinLimit_IsPerUser_HigherAllowanceUserIsNotBlockedBySamespend()
    {
        await using var db = CreateDb();
        var userA = Guid.NewGuid();
        var userB = Guid.NewGuid();
        // Both accrue $0.51. A has a low $0.50 allowance (blocked); B has a $5.00 allowance (allowed).
        db.LlmUsages.Add(Usage(userA, 0, 34_000));
        db.LlmUsages.Add(Usage(userB, 0, 34_000));
        db.BillingAccounts.Add(Account(userA, 0.50m));
        db.BillingAccounts.Add(Account(userB, 5.00m));
        await db.SaveChangesAsync();

        var svc = Service(db, defaultAllowance: 0.50m);

        await Assert.ThrowsAsync<UsageLimitExceededException>(() => svc.EnsureWithinLimitAsync(userA));
        await svc.EnsureWithinLimitAsync(userB); // no throw — proves per-user enforcement
    }

    // ---- F-AI-14.6 — threshold is on accrued-so-far, not the pending call -----

    [Fact]
    public async Task EnsureWithinLimit_Allows_WhenStillAboveZero_EvenIfPendingCallWouldExceed()
    {
        await using var db = CreateDb();
        var userId = Guid.NewGuid();
        // Accrued so far $0.45, still under the $0.50 allowance => allowed, regardless of
        // whether the next call would push spend past the allowance.
        db.LlmUsages.Add(Usage(userId, 0, 30_000)); // $0.45
        db.BillingAccounts.Add(Account(userId, 0.50m));
        await db.SaveChangesAsync();

        await Service(db, defaultAllowance: 0.50m).EnsureWithinLimitAsync(userId); // no throw
    }

    // ---- F-AI-14.5 — billing-balance exhaustion message ----------------------

    [Fact]
    public async Task UsageLimitExceeded_MessageReadsAsBillingBalanceExhaustion()
    {
        var ex = new UsageLimitExceededException(0.50m);

        // Distinct billing-balance language, not a generic "AI is unavailable" error.
        Assert.Contains("balance", ex.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("$0.50", ex.Message);
        Assert.Equal(0.50m, ex.LimitUsd);
    }

    [Fact]
    public async Task EnsureWithinLimit_NullUser_IsExempt()
    {
        await using var db = CreateDb();
        // System call (no user) must never be blocked.
        await Service(db, defaultAllowance: 0.50m).EnsureWithinLimitAsync(null); // no throw
    }
}

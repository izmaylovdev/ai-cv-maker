using CvApi.Domain.Entities;
using CvApi.Domain.Repositories;
using CvApi.Features.Billing;
using CvApi.Features.Usage;
using Microsoft.Extensions.Options;
using Xunit;

namespace CvApi.Tests;

/// <summary>
/// Dedicated coverage for the credit-exactly-once invariant (ADR-0021
/// decision #4), written before the Firestore cutover rather than after.
///
/// These tests target <see cref="IPaymentConfirmationStore"/> semantics
/// directly, so the same suite can be pointed at the Firestore implementation
/// to prove the transaction preserves the behaviour. Anything asserted here is
/// a contract every implementation must satisfy.
/// </summary>
public class PaymentConfirmationTests
{
    private const decimal SeedAllowance = 0.50m;

    private static UsageService Usage(InMemoryStore store, decimal? defaultAllowance = SeedAllowance)
        => new(store, store, store, store,
            Options.Create(new LlmPricingOptions()),
            Options.Create(new UsageLimitOptions { MaxCostUsdPerUser = SeedAllowance }),
            Options.Create(new BillingOptions { DefaultAllowanceUsd = defaultAllowance }));

    private static PaymentConfirmationService Service(InMemoryStore store)
        => new(store, Usage(store));

    private static TopUpPayment Pending(InMemoryStore store, Guid userId, decimal amount = 10m)
    {
        var payment = new TopUpPayment
        {
            UserId = userId,
            AmountUsd = amount,
            Channel = "fake-stripe",
            Status = TopUpStatus.Pending,
        };
        store.TopUpPayments.Add(payment);
        return payment;
    }

    // -------------------------------------------------------------------------
    // The core invariant
    // -------------------------------------------------------------------------

    [Fact]
    public async Task Confirm_Success_CreditsExactlyOnce_AndMarksPaid()
    {
        var store = new InMemoryStore();
        var userId = Guid.NewGuid();
        store.BillingAccounts.Add(new BillingAccount { UserId = userId, AllowanceUsd = 2m });
        var payment = Pending(store, userId, 10m);

        await Service(store).ConfirmAsync(payment, success: true);

        Assert.Equal(TopUpStatus.Paid, payment.Status);
        Assert.Equal(12m, store.BillingAccounts.Single(b => b.UserId == userId).AllowanceUsd);
    }

    [Fact]
    public async Task Confirm_RepeatedSuccess_DoesNotDoubleCredit()
    {
        var store = new InMemoryStore();
        var userId = Guid.NewGuid();
        store.BillingAccounts.Add(new BillingAccount { UserId = userId, AllowanceUsd = 2m });
        var payment = Pending(store, userId, 10m);
        var service = Service(store);

        // A provider retrying its webhook five times must credit once.
        for (var i = 0; i < 5; i++)
            await service.ConfirmAsync(payment, success: true);

        Assert.Equal(12m, store.BillingAccounts.Single(b => b.UserId == userId).AllowanceUsd);
        Assert.Single(store.BillingAccounts);
    }

    [Fact]
    public async Task Store_SecondConfirmReportsAlreadyTerminal_AndLeavesBalanceUntouched()
    {
        var store = new InMemoryStore();
        var userId = Guid.NewGuid();
        store.BillingAccounts.Add(new BillingAccount { UserId = userId, AllowanceUsd = 2m });
        var payment = Pending(store, userId, 10m);

        var first = await ((IPaymentConfirmationStore)store)
            .TryConfirmAsync(payment.Id, success: true, SeedAllowance);
        var second = await ((IPaymentConfirmationStore)store)
            .TryConfirmAsync(payment.Id, success: true, SeedAllowance);

        Assert.Equal(PaymentConfirmationOutcome.Transitioned, first);
        Assert.Equal(PaymentConfirmationOutcome.AlreadyTerminal, second);
        Assert.Equal(12m, store.BillingAccounts.Single(b => b.UserId == userId).AllowanceUsd);
    }

    // -------------------------------------------------------------------------
    // Seeding a first-time account
    // -------------------------------------------------------------------------

    [Fact]
    public async Task Confirm_NoBillingAccount_SeedsFromEffectiveAllowance_NotFromZero()
    {
        var store = new InMemoryStore();
        var userId = Guid.NewGuid();
        var payment = Pending(store, userId, 10m);

        await Service(store).ConfirmAsync(payment, success: true);

        // Seeding a zero-based row would silently erase the user's default
        // allowance; the balance must be default + amount.
        var account = store.BillingAccounts.Single(b => b.UserId == userId);
        Assert.Equal(SeedAllowance + 10m, account.AllowanceUsd);
    }

    // -------------------------------------------------------------------------
    // Terminal statuses never regress
    // -------------------------------------------------------------------------

    [Fact]
    public async Task Confirm_Failure_MarksFailed_AndCreditsNothing()
    {
        var store = new InMemoryStore();
        var userId = Guid.NewGuid();
        store.BillingAccounts.Add(new BillingAccount { UserId = userId, AllowanceUsd = 2m });
        var payment = Pending(store, userId, 10m);

        await Service(store).ConfirmAsync(payment, success: false);

        Assert.Equal(TopUpStatus.Failed, payment.Status);
        Assert.Equal(2m, store.BillingAccounts.Single(b => b.UserId == userId).AllowanceUsd);
    }

    [Fact]
    public async Task Confirm_PaidThenFailure_DoesNotRegressStatusOrBalance()
    {
        var store = new InMemoryStore();
        var userId = Guid.NewGuid();
        store.BillingAccounts.Add(new BillingAccount { UserId = userId, AllowanceUsd = 2m });
        var payment = Pending(store, userId, 10m);
        var service = Service(store);

        await service.ConfirmAsync(payment, success: true);
        await service.ConfirmAsync(payment, success: false); // late "failed" webhook

        Assert.Equal(TopUpStatus.Paid, payment.Status);
        Assert.Equal(12m, store.BillingAccounts.Single(b => b.UserId == userId).AllowanceUsd);
    }

    [Fact]
    public async Task Confirm_FailedThenSuccess_DoesNotCredit()
    {
        var store = new InMemoryStore();
        var userId = Guid.NewGuid();
        store.BillingAccounts.Add(new BillingAccount { UserId = userId, AllowanceUsd = 2m });
        var payment = Pending(store, userId, 10m);
        var service = Service(store);

        await service.ConfirmAsync(payment, success: false);
        await service.ConfirmAsync(payment, success: true);

        Assert.Equal(TopUpStatus.Failed, payment.Status);
        Assert.Equal(2m, store.BillingAccounts.Single(b => b.UserId == userId).AllowanceUsd);
    }

    // -------------------------------------------------------------------------
    // Isolation and unknown payments
    // -------------------------------------------------------------------------

    [Fact]
    public async Task Confirm_CreditsOnlyThePayingUser()
    {
        var store = new InMemoryStore();
        var payer = Guid.NewGuid();
        var bystander = Guid.NewGuid();
        store.BillingAccounts.Add(new BillingAccount { UserId = payer, AllowanceUsd = 1m });
        store.BillingAccounts.Add(new BillingAccount { UserId = bystander, AllowanceUsd = 7m });
        var payment = Pending(store, payer, 5m);

        await Service(store).ConfirmAsync(payment, success: true);

        Assert.Equal(6m, store.BillingAccounts.Single(b => b.UserId == payer).AllowanceUsd);
        Assert.Equal(7m, store.BillingAccounts.Single(b => b.UserId == bystander).AllowanceUsd);
    }

    [Fact]
    public async Task Store_UnknownPayment_ReportsNotFound()
    {
        var store = new InMemoryStore();

        var outcome = await ((IPaymentConfirmationStore)store)
            .TryConfirmAsync(Guid.NewGuid(), success: true, SeedAllowance);

        Assert.Equal(PaymentConfirmationOutcome.NotFound, outcome);
        Assert.Empty(store.BillingAccounts);
    }

    [Theory]
    [InlineData(5)]
    [InlineData(10)]
    [InlineData(20)]
    public async Task Confirm_CreditsTheExactAmount(int amount)
    {
        var store = new InMemoryStore();
        var userId = Guid.NewGuid();
        store.BillingAccounts.Add(new BillingAccount { UserId = userId, AllowanceUsd = 0m });
        var payment = Pending(store, userId, amount);

        await Service(store).ConfirmAsync(payment, success: true);

        Assert.Equal(amount, store.BillingAccounts.Single(b => b.UserId == userId).AllowanceUsd);
    }
}

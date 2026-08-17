using CvApi.Domain.Entities;
using CvApi.Domain.Repositories;
using CvApi.Features.Billing;
using CvApi.Features.Usage;
using CvApi.Infrastructure.Persistence.Firestore;
using Google.Cloud.Firestore;
using Microsoft.Extensions.Options;
using Xunit;

namespace CvApi.Tests;

/// <summary>
/// The store-agnostic half of <see cref="PaymentConfirmationTests"/>: seeding,
/// the repositories the service needs, and a read-back of every billing account
/// that exists. Implemented once over the in-memory fake and once over real
/// Firestore, so the same assertions prove the same invariant on both.
/// </summary>
public interface IPaymentConfirmationBackend
{
    IPaymentConfirmationStore ConfirmationStore { get; }
    ILlmUsageRepository Usage { get; }
    IAppSettingRepository Settings { get; }
    IBillingAccountRepository BillingAccounts { get; }
    IUserRepository Users { get; }

    Task SeedAsync(BillingAccount account);
    Task SeedAsync(TopUpPayment payment);

    /// <summary>Every billing account in the store, in no particular order.</summary>
    Task<IReadOnlyList<BillingAccount>> ReadBillingAccountsAsync();
}

public sealed class InMemoryPaymentConfirmationBackend : IPaymentConfirmationBackend
{
    private readonly InMemoryStore _store = new();

    public IPaymentConfirmationStore ConfirmationStore => _store;
    public ILlmUsageRepository Usage => _store;
    public IAppSettingRepository Settings => _store;
    public IBillingAccountRepository BillingAccounts => _store;
    public IUserRepository Users => _store;

    public Task SeedAsync(BillingAccount account)
    {
        _store.BillingAccounts.Add(account);
        return Task.CompletedTask;
    }

    public Task SeedAsync(TopUpPayment payment)
    {
        _store.TopUpPayments.Add(payment);
        return Task.CompletedTask;
    }

    public Task<IReadOnlyList<BillingAccount>> ReadBillingAccountsAsync() =>
        Task.FromResult<IReadOnlyList<BillingAccount>>(_store.BillingAccounts.ToList());
}

/// <summary>
/// The same contract against a real Firestore database on the emulator. This is
/// the point of the exercise: the billing invariant is the highest-risk part of
/// ADR-0021, and the EF code it replaced could double-credit, so "the Firestore
/// transaction really does hold the invariant" has to be demonstrated rather
/// than assumed.
/// </summary>
public sealed class FirestorePaymentConfirmationBackend : IPaymentConfirmationBackend
{
    private readonly FirestoreDb _db = FirestoreEmulator.CreateIsolatedDb();

    public FirestorePaymentConfirmationBackend()
    {
        ConfirmationStore = new FirestorePaymentConfirmationStore(_db);
        Usage = new FirestoreLlmUsageRepository(_db);
        Settings = new FirestoreAppSettingRepository(_db);
        BillingAccounts = new FirestoreBillingAccountRepository(_db);
        Users = new FirestoreUserRepository(_db);
    }

    public IPaymentConfirmationStore ConfirmationStore { get; }
    public ILlmUsageRepository Usage { get; }
    public IAppSettingRepository Settings { get; }
    public IBillingAccountRepository BillingAccounts { get; }
    public IUserRepository Users { get; }

    public Task SeedAsync(BillingAccount account) =>
        _db.Collection("users").Document(account.UserId.ToString("D"))
            .Collection("billing").Document("account")
            .SetAsync(new Dictionary<string, object?>
            {
                ["id"] = account.Id.ToString("D"),
                ["allowanceUsd"] = account.AllowanceUsd.ToString(System.Globalization.CultureInfo.InvariantCulture),
                ["currency"] = account.Currency,
                ["updatedAt"] = Timestamp.FromDateTime(DateTime.SpecifyKind(account.UpdatedAt, DateTimeKind.Utc)),
            });

    public Task SeedAsync(TopUpPayment payment) =>
        _db.Collection("topUpPayments").Document(payment.Id.ToString("D"))
            .SetAsync(new Dictionary<string, object?>
            {
                ["userId"] = payment.UserId.ToString("D"),
                ["amountUsd"] = payment.AmountUsd.ToString(System.Globalization.CultureInfo.InvariantCulture),
                ["channel"] = payment.Channel,
                ["status"] = payment.Status,
                ["externalId"] = payment.ExternalId,
                ["createdAt"] = Timestamp.FromDateTime(DateTime.SpecifyKind(payment.CreatedAt, DateTimeKind.Utc)),
                ["updatedAt"] = Timestamp.FromDateTime(DateTime.SpecifyKind(payment.UpdatedAt, DateTimeKind.Utc)),
            });

    /// <summary>
    /// Billing accounts live at users/{userId}/billing/account, so "all of them"
    /// is a collection-group query over <c>billing</c>.
    /// </summary>
    public async Task<IReadOnlyList<BillingAccount>> ReadBillingAccountsAsync()
    {
        var snapshot = await _db.CollectionGroup("billing").GetSnapshotAsync();
        return snapshot.Documents
            .Select(d => new BillingAccount
            {
                Id = Guid.Parse(d.GetValue<string>("id")),
                UserId = Guid.Parse(d.Reference.Parent.Parent!.Id),
                AllowanceUsd = decimal.Parse(
                    d.GetValue<string>("allowanceUsd"),
                    System.Globalization.NumberStyles.Number,
                    System.Globalization.CultureInfo.InvariantCulture),
                Currency = d.GetValue<string>("currency"),
                UpdatedAt = d.GetValue<Timestamp>("updatedAt").ToDateTime(),
            })
            .ToList();
    }
}

/// <summary>
/// The twelve credit-exactly-once scenarios (ADR-0021 decision #4), written
/// once and run against every implementation of
/// <see cref="IPaymentConfirmationStore"/>. Anything asserted here is a contract
/// every implementation must satisfy.
/// </summary>
public sealed class PaymentConfirmationContract(IPaymentConfirmationBackend backend)
{
    private const decimal SeedAllowance = 0.50m;

    private UsageService Usage(decimal? defaultAllowance = SeedAllowance)
        => new(backend.Usage, backend.Settings, backend.BillingAccounts, backend.Users,
            Options.Create(new LlmPricingOptions()),
            Options.Create(new UsageLimitOptions { MaxCostUsdPerUser = SeedAllowance }),
            Options.Create(new BillingOptions { DefaultAllowanceUsd = defaultAllowance }));

    private PaymentConfirmationService Service()
        => new(backend.ConfirmationStore, Usage());

    private async Task<TopUpPayment> PendingAsync(Guid userId, decimal amount = 10m)
    {
        var payment = new TopUpPayment
        {
            UserId = userId,
            AmountUsd = amount,
            Channel = "fake-stripe",
            Status = TopUpStatus.Pending,
        };
        await backend.SeedAsync(payment);
        return payment;
    }

    private async Task<BillingAccount> AccountAsync(Guid userId)
        => (await backend.ReadBillingAccountsAsync()).Single(b => b.UserId == userId);

    // -------------------------------------------------------------------------
    // The core invariant
    // -------------------------------------------------------------------------

    public async Task Confirm_Success_CreditsExactlyOnce_AndMarksPaid()
    {
        var userId = Guid.NewGuid();
        await backend.SeedAsync(new BillingAccount { UserId = userId, AllowanceUsd = 2m });
        var payment = await PendingAsync(userId, 10m);

        await Service().ConfirmAsync(payment, success: true);

        Assert.Equal(TopUpStatus.Paid, payment.Status);
        Assert.Equal(12m, (await AccountAsync(userId)).AllowanceUsd);
    }

    public async Task Confirm_RepeatedSuccess_DoesNotDoubleCredit()
    {
        var userId = Guid.NewGuid();
        await backend.SeedAsync(new BillingAccount { UserId = userId, AllowanceUsd = 2m });
        var payment = await PendingAsync(userId, 10m);
        var service = Service();

        // A provider retrying its webhook five times must credit once.
        for (var i = 0; i < 5; i++)
            await service.ConfirmAsync(payment, success: true);

        Assert.Equal(12m, (await AccountAsync(userId)).AllowanceUsd);
        Assert.Single(await backend.ReadBillingAccountsAsync());
    }

    public async Task Store_SecondConfirmReportsAlreadyTerminal_AndLeavesBalanceUntouched()
    {
        var userId = Guid.NewGuid();
        await backend.SeedAsync(new BillingAccount { UserId = userId, AllowanceUsd = 2m });
        var payment = await PendingAsync(userId, 10m);

        var first = await backend.ConfirmationStore
            .TryConfirmAsync(payment.Id, success: true, SeedAllowance);
        var second = await backend.ConfirmationStore
            .TryConfirmAsync(payment.Id, success: true, SeedAllowance);

        Assert.Equal(PaymentConfirmationOutcome.Transitioned, first);
        Assert.Equal(PaymentConfirmationOutcome.AlreadyTerminal, second);
        Assert.Equal(12m, (await AccountAsync(userId)).AllowanceUsd);
    }

    // -------------------------------------------------------------------------
    // Seeding a first-time account
    // -------------------------------------------------------------------------

    public async Task Confirm_NoBillingAccount_SeedsFromEffectiveAllowance_NotFromZero()
    {
        var userId = Guid.NewGuid();
        var payment = await PendingAsync(userId, 10m);

        await Service().ConfirmAsync(payment, success: true);

        // Seeding a zero-based row would silently erase the user's default
        // allowance; the balance must be default + amount.
        var account = await AccountAsync(userId);
        Assert.Equal(SeedAllowance + 10m, account.AllowanceUsd);
    }

    // -------------------------------------------------------------------------
    // Terminal statuses never regress
    // -------------------------------------------------------------------------

    public async Task Confirm_Failure_MarksFailed_AndCreditsNothing()
    {
        var userId = Guid.NewGuid();
        await backend.SeedAsync(new BillingAccount { UserId = userId, AllowanceUsd = 2m });
        var payment = await PendingAsync(userId, 10m);

        await Service().ConfirmAsync(payment, success: false);

        Assert.Equal(TopUpStatus.Failed, payment.Status);
        Assert.Equal(2m, (await AccountAsync(userId)).AllowanceUsd);
    }

    public async Task Confirm_PaidThenFailure_DoesNotRegressStatusOrBalance()
    {
        var userId = Guid.NewGuid();
        await backend.SeedAsync(new BillingAccount { UserId = userId, AllowanceUsd = 2m });
        var payment = await PendingAsync(userId, 10m);
        var service = Service();

        await service.ConfirmAsync(payment, success: true);
        await service.ConfirmAsync(payment, success: false); // late "failed" webhook

        Assert.Equal(TopUpStatus.Paid, payment.Status);
        Assert.Equal(12m, (await AccountAsync(userId)).AllowanceUsd);
    }

    public async Task Confirm_FailedThenSuccess_DoesNotCredit()
    {
        var userId = Guid.NewGuid();
        await backend.SeedAsync(new BillingAccount { UserId = userId, AllowanceUsd = 2m });
        var payment = await PendingAsync(userId, 10m);
        var service = Service();

        await service.ConfirmAsync(payment, success: false);
        await service.ConfirmAsync(payment, success: true);

        Assert.Equal(TopUpStatus.Failed, payment.Status);
        Assert.Equal(2m, (await AccountAsync(userId)).AllowanceUsd);
    }

    // -------------------------------------------------------------------------
    // Isolation and unknown payments
    // -------------------------------------------------------------------------

    public async Task Confirm_CreditsOnlyThePayingUser()
    {
        var payer = Guid.NewGuid();
        var bystander = Guid.NewGuid();
        await backend.SeedAsync(new BillingAccount { UserId = payer, AllowanceUsd = 1m });
        await backend.SeedAsync(new BillingAccount { UserId = bystander, AllowanceUsd = 7m });
        var payment = await PendingAsync(payer, 5m);

        await Service().ConfirmAsync(payment, success: true);

        Assert.Equal(6m, (await AccountAsync(payer)).AllowanceUsd);
        Assert.Equal(7m, (await AccountAsync(bystander)).AllowanceUsd);
    }

    public async Task Store_UnknownPayment_ReportsNotFound()
    {
        var outcome = await backend.ConfirmationStore
            .TryConfirmAsync(Guid.NewGuid(), success: true, SeedAllowance);

        Assert.Equal(PaymentConfirmationOutcome.NotFound, outcome);
        Assert.Empty(await backend.ReadBillingAccountsAsync());
    }

    public async Task Confirm_CreditsTheExactAmount(int amount)
    {
        var userId = Guid.NewGuid();
        await backend.SeedAsync(new BillingAccount { UserId = userId, AllowanceUsd = 0m });
        var payment = await PendingAsync(userId, amount);

        await Service().ConfirmAsync(payment, success: true);

        Assert.Equal(amount, (await AccountAsync(userId)).AllowanceUsd);
    }
}

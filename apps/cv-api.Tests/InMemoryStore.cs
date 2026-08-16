using CvApi.Domain.Entities;
using CvApi.Domain.Repositories;
using Microsoft.Extensions.DependencyInjection;

namespace CvApi.Tests;

/// <summary>
/// In-memory implementation of every ADR-0021 repository interface, used in
/// place of EF Core's UseInMemoryDatabase.
///
/// The point of the seam is that tests no longer assert against a *database*
/// (relational or otherwise) — they assert against the operations the
/// application actually performs. That keeps them meaningful across the
/// Postgres → Firestore move instead of silently encoding EF semantics.
///
/// The collections are exposed directly for seeding, and <see cref="SaveChangesAsync"/>
/// is a no-op that exists only so seeding code reads the same as it did before.
/// Entities are stored by reference, so mutations made by a service are visible
/// to assertions — matching how EF's change tracker behaved here.
/// </summary>
public class InMemoryStore :
    IUserRepository,
    IProfileRepository,
    IGeneratedCvRepository,
    ILlmUsageRepository,
    IAppSettingRepository,
    IRefreshTokenRepository,
    IBillingAccountRepository,
    ITopUpPaymentRepository,
    IPaymentConfirmationStore
{
    public List<User> Users { get; } = [];
    public List<Profile> Profiles { get; } = [];
    public List<GeneratedCv> GeneratedCvs { get; } = [];
    public List<LlmUsage> LlmUsages { get; } = [];
    public List<RefreshToken> RefreshTokens { get; } = [];
    public List<AppSetting> AppSettings { get; } = [];
    public List<BillingAccount> BillingAccounts { get; } = [];
    public List<TopUpPayment> TopUpPayments { get; } = [];

    /// <summary>No-op; writes are immediate. Kept so seeding code reads naturally.</summary>
    public Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;

    // ---- IUserRepository ----
    Task<User?> IUserRepository.GetByIdAsync(Guid id, CancellationToken ct) =>
        Task.FromResult(Users.FirstOrDefault(u => u.Id == id));
    public Task<User?> GetByEmailAsync(string email, CancellationToken ct = default) =>
        Task.FromResult(Users.FirstOrDefault(u => u.Email == email));
    public Task<User?> GetByGoogleIdAsync(string googleId, CancellationToken ct = default) =>
        Task.FromResult(Users.FirstOrDefault(u => u.GoogleId == googleId));
    public Task<bool> EmailExistsAsync(string email, CancellationToken ct = default) =>
        Task.FromResult(Users.Any(u => u.Email == email));
    public Task<IReadOnlyList<User>> ListAllAsync(CancellationToken ct = default) =>
        Task.FromResult<IReadOnlyList<User>>(Users.ToList());
    public Task AddAsync(User user, CancellationToken ct = default) { Users.Add(user); return Task.CompletedTask; }
    public Task UpdateAsync(User user, CancellationToken ct = default) => Task.CompletedTask;

    // ---- IProfileRepository ----
    public Task<Profile?> GetForUserAsync(Guid id, Guid userId, CancellationToken ct = default) =>
        Task.FromResult(Profiles.FirstOrDefault(p => p.Id == id && p.UserId == userId));
    Task<IReadOnlyList<Profile>> IProfileRepository.ListByUserAsync(Guid userId, CancellationToken ct) =>
        Task.FromResult<IReadOnlyList<Profile>>(Profiles.Where(p => p.UserId == userId).ToList());
    public Task<IReadOnlyDictionary<Guid, int>> CountByUserAsync(
        IReadOnlyCollection<Guid> userIds, CancellationToken ct = default) =>
        Task.FromResult<IReadOnlyDictionary<Guid, int>>(
            Profiles.Where(p => userIds.Contains(p.UserId))
                    .GroupBy(p => p.UserId)
                    .ToDictionary(g => g.Key, g => g.Count()));
    public Task AddAsync(Profile profile, CancellationToken ct = default) { Profiles.Add(profile); return Task.CompletedTask; }
    public Task UpdateAsync(Profile profile, CancellationToken ct = default) => Task.CompletedTask;
    public Task DeleteAsync(Profile profile, CancellationToken ct = default)
    {
        // Mirrors the explicit cascade the Firestore implementation performs;
        // under EF this was an ON DELETE CASCADE foreign key.
        GeneratedCvs.RemoveAll(g => g.ProfileId == profile.Id);
        Profiles.Remove(profile);
        return Task.CompletedTask;
    }

    // ---- IGeneratedCvRepository ----
    public Task<GeneratedCv?> GetForProfileAsync(Guid id, Guid profileId, CancellationToken ct = default) =>
        Task.FromResult(GeneratedCvs.FirstOrDefault(g => g.Id == id && g.ProfileId == profileId));
    public Task<IReadOnlyList<GeneratedCv>> ListByProfileAsync(Guid profileId, CancellationToken ct = default) =>
        Task.FromResult<IReadOnlyList<GeneratedCv>>(GeneratedCvs.Where(g => g.ProfileId == profileId).ToList());
    public Task AddAsync(GeneratedCv cv, CancellationToken ct = default) { GeneratedCvs.Add(cv); return Task.CompletedTask; }
    public Task DeleteAsync(GeneratedCv cv, CancellationToken ct = default) { GeneratedCvs.Remove(cv); return Task.CompletedTask; }

    // ---- ILlmUsageRepository ----
    public Task AddAsync(LlmUsage usage, CancellationToken ct = default) { LlmUsages.Add(usage); return Task.CompletedTask; }
    Task<IReadOnlyList<LlmUsage>> ILlmUsageRepository.ListByUserAsync(Guid userId, CancellationToken ct) =>
        Task.FromResult<IReadOnlyList<LlmUsage>>(LlmUsages.Where(u => u.UserId == userId).ToList());
    public Task<IReadOnlyList<LlmUsage>> ListAllAttributedAsync(CancellationToken ct = default) =>
        Task.FromResult<IReadOnlyList<LlmUsage>>(LlmUsages.Where(u => u.UserId != null).ToList());

    // ---- IAppSettingRepository ----
    public Task<AppSetting?> GetAsync(string key, CancellationToken ct = default) =>
        Task.FromResult(AppSettings.FirstOrDefault(s => s.Key == key));
    public Task UpsertAsync(string key, string value, CancellationToken ct = default)
    {
        var existing = AppSettings.FirstOrDefault(s => s.Key == key);
        if (existing is null)
            AppSettings.Add(new AppSetting { Key = key, Value = value, UpdatedAt = DateTime.UtcNow });
        else { existing.Value = value; existing.UpdatedAt = DateTime.UtcNow; }
        return Task.CompletedTask;
    }

    // ---- IRefreshTokenRepository ----
    public Task<RefreshToken?> GetByTokenAsync(string tokenHash, CancellationToken ct = default) =>
        Task.FromResult(RefreshTokens.FirstOrDefault(r => r.Token == tokenHash));
    public Task AddAsync(RefreshToken token, CancellationToken ct = default) { RefreshTokens.Add(token); return Task.CompletedTask; }
    public Task UpdateAsync(RefreshToken token, CancellationToken ct = default) => Task.CompletedTask;

    // ---- IBillingAccountRepository ----
    public Task<BillingAccount?> GetByUserAsync(Guid userId, CancellationToken ct = default) =>
        Task.FromResult(BillingAccounts.FirstOrDefault(b => b.UserId == userId));

    // ---- ITopUpPaymentRepository ----
    Task<TopUpPayment?> ITopUpPaymentRepository.GetByIdAsync(Guid id, CancellationToken ct) =>
        Task.FromResult(TopUpPayments.FirstOrDefault(p => p.Id == id));
    public Task<TopUpPayment?> GetByExternalIdAsync(string externalId, CancellationToken ct = default) =>
        Task.FromResult(TopUpPayments.FirstOrDefault(p => p.ExternalId == externalId));
    Task<IReadOnlyList<TopUpPayment>> ITopUpPaymentRepository.ListByUserAsync(Guid userId, CancellationToken ct) =>
        Task.FromResult<IReadOnlyList<TopUpPayment>>(TopUpPayments.Where(p => p.UserId == userId).ToList());
    public Task AddAsync(TopUpPayment payment, CancellationToken ct = default) { TopUpPayments.Add(payment); return Task.CompletedTask; }
    public Task UpdateAsync(TopUpPayment payment, CancellationToken ct = default) => Task.CompletedTask;

    // ---- IPaymentConfirmationStore ----
    public Task<PaymentConfirmationOutcome> TryConfirmAsync(
        Guid paymentId, bool success, decimal seedAllowanceUsd, CancellationToken ct = default)
    {
        var payment = TopUpPayments.FirstOrDefault(p => p.Id == paymentId);
        if (payment is null)
            return Task.FromResult(PaymentConfirmationOutcome.NotFound);
        if (payment.Status != TopUpStatus.Pending)
            return Task.FromResult(PaymentConfirmationOutcome.AlreadyTerminal);

        if (success)
        {
            var account = BillingAccounts.FirstOrDefault(b => b.UserId == payment.UserId);
            if (account is not null)
            {
                account.AllowanceUsd += payment.AmountUsd;
                account.UpdatedAt = DateTime.UtcNow;
            }
            else
            {
                BillingAccounts.Add(new BillingAccount
                {
                    UserId = payment.UserId,
                    AllowanceUsd = seedAllowanceUsd + payment.AmountUsd,
                    UpdatedAt = DateTime.UtcNow,
                });
            }
            payment.Status = TopUpStatus.Paid;
        }
        else
        {
            payment.Status = TopUpStatus.Failed;
        }
        payment.UpdatedAt = DateTime.UtcNow;
        return Task.FromResult(PaymentConfirmationOutcome.Transitioned);
    }
}

/// <summary>
/// Registers one shared <see cref="InMemoryStore"/> as every repository
/// interface, for WebApplicationFactory-based tests. Replaces the previous
/// "swap the DbContext for UseInMemoryDatabase" trick — after ADR-0021 there is
/// no DbContext to swap, and faking the seam is what keeps these tests honest.
/// </summary>
public static class InMemoryStoreServiceCollectionExtensions
{
    public static IServiceCollection UseInMemoryStore(
        this Microsoft.Extensions.DependencyInjection.IServiceCollection services,
        InMemoryStore store)
    {
        services.AddSingleton(store);
        services.AddSingleton<IUserRepository>(store);
        services.AddSingleton<IProfileRepository>(store);
        services.AddSingleton<IGeneratedCvRepository>(store);
        services.AddSingleton<ILlmUsageRepository>(store);
        services.AddSingleton<IAppSettingRepository>(store);
        services.AddSingleton<IRefreshTokenRepository>(store);
        services.AddSingleton<IBillingAccountRepository>(store);
        services.AddSingleton<ITopUpPaymentRepository>(store);
        services.AddSingleton<IPaymentConfirmationStore>(store);
        return services;
    }
}

using CvApi.Domain.Entities;

namespace CvApi.Domain.Repositories;

/// <summary>
/// Persistence seam introduced by ADR-0021. Services depend on these
/// interfaces rather than on a DbContext, so the Postgres → Firestore move is
/// a change of implementation rather than a change of every call site — and so
/// tests can fake persistence without needing a database at all.
///
/// The operations here are deliberately expressed as the queries the
/// application actually issues (mostly key lookups and small owner-scoped
/// scans) rather than as a generic IQueryable. Firestore has no joins and
/// bills per document read, so an open-ended query surface would be a trap.
/// </summary>
public interface IUserRepository
{
    Task<User?> GetByIdAsync(Guid id, CancellationToken ct = default);
    Task<User?> GetByEmailAsync(string email, CancellationToken ct = default);
    Task<User?> GetByGoogleIdAsync(string googleId, CancellationToken ct = default);
    Task<bool> EmailExistsAsync(string email, CancellationToken ct = default);
    Task<IReadOnlyList<User>> ListAllAsync(CancellationToken ct = default);
    Task AddAsync(User user, CancellationToken ct = default);
    Task UpdateAsync(User user, CancellationToken ct = default);
}

public interface IProfileRepository
{
    /// <summary>Owner-scoped fetch; returns null when the profile is missing *or* not the user's.</summary>
    Task<Profile?> GetForUserAsync(Guid id, Guid userId, CancellationToken ct = default);
    Task<IReadOnlyList<Profile>> ListByUserAsync(Guid userId, CancellationToken ct = default);

    /// <summary>
    /// Profile count per user, for the admin users list. Was a navigation-property
    /// count in EF; in Firestore it is a server-side count() aggregation so the
    /// documents themselves are not read.
    /// </summary>
    Task<IReadOnlyDictionary<Guid, int>> CountByUserAsync(IReadOnlyCollection<Guid> userIds, CancellationToken ct = default);
    Task AddAsync(Profile profile, CancellationToken ct = default);
    Task UpdateAsync(Profile profile, CancellationToken ct = default);

    /// <summary>
    /// Deletes the profile and its GeneratedCvs. Postgres did this with an ON
    /// DELETE CASCADE foreign key; Firestore has none, so the cascade is
    /// explicit here (ADR-0021: "referential integrity becomes a code invariant").
    /// </summary>
    Task DeleteAsync(Profile profile, CancellationToken ct = default);
}

public interface IGeneratedCvRepository
{
    Task<GeneratedCv?> GetForProfileAsync(Guid id, Guid profileId, CancellationToken ct = default);
    Task<IReadOnlyList<GeneratedCv>> ListByProfileAsync(Guid profileId, CancellationToken ct = default);
    Task AddAsync(GeneratedCv cv, CancellationToken ct = default);
    Task DeleteAsync(GeneratedCv cv, CancellationToken ct = default);
}

public interface ILlmUsageRepository
{
    Task AddAsync(LlmUsage usage, CancellationToken ct = default);
    Task<IReadOnlyList<LlmUsage>> ListByUserAsync(Guid userId, CancellationToken ct = default);

    /// <summary>
    /// All attributed usage rows, for the admin per-user rollup. Replaces the
    /// EF join against Users — the caller resolves emails via IUserRepository,
    /// since Firestore cannot join.
    /// </summary>
    Task<IReadOnlyList<LlmUsage>> ListAllAttributedAsync(CancellationToken ct = default);
}

public interface IAppSettingRepository
{
    Task<AppSetting?> GetAsync(string key, CancellationToken ct = default);
    Task UpsertAsync(string key, string value, CancellationToken ct = default);
}

public interface IRefreshTokenRepository
{
    Task<RefreshToken?> GetByTokenAsync(string tokenHash, CancellationToken ct = default);
    Task AddAsync(RefreshToken token, CancellationToken ct = default);
    Task UpdateAsync(RefreshToken token, CancellationToken ct = default);
}

public interface IBillingAccountRepository
{
    Task<BillingAccount?> GetByUserAsync(Guid userId, CancellationToken ct = default);
}

public interface ITopUpPaymentRepository
{
    Task<TopUpPayment?> GetByIdAsync(Guid id, CancellationToken ct = default);
    Task<TopUpPayment?> GetByExternalIdAsync(string externalId, CancellationToken ct = default);
    Task<IReadOnlyList<TopUpPayment>> ListByUserAsync(Guid userId, CancellationToken ct = default);
    Task AddAsync(TopUpPayment payment, CancellationToken ct = default);
    Task UpdateAsync(TopUpPayment payment, CancellationToken ct = default);
}

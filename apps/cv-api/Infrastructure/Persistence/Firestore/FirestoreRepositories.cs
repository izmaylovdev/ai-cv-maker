using CvApi.Domain.Entities;
using CvApi.Domain.Repositories;
using Google.Cloud.Firestore;

namespace CvApi.Infrastructure.Persistence.Firestore;

// Firestore implementations of the ADR-0021 persistence seam, and the only
// ones — the EF Core implementations and AppDbContext were removed with the
// Postgres path.
//
// Every method here is one of the queries the application actually issues.
// There is no generic query surface on purpose: Firestore has no joins and
// bills per document read, so each call site's cost is visible in this file.

/// <summary>Shared document/collection references for the fixed ADR-0021 layout.</summary>
internal static class FirestorePaths
{
    public static CollectionReference Users(FirestoreDb db) =>
        db.Collection(FirestoreCollections.Users);

    public static DocumentReference User(FirestoreDb db, Guid userId) =>
        Users(db).Document(FirestoreValues.FromGuid(userId));

    public static CollectionReference Profiles(FirestoreDb db, Guid userId) =>
        User(db, userId).Collection(FirestoreCollections.Profiles);

    public static DocumentReference Profile(FirestoreDb db, Guid userId, Guid profileId) =>
        Profiles(db, userId).Document(FirestoreValues.FromGuid(profileId));

    public static DocumentReference BillingAccount(FirestoreDb db, Guid userId) =>
        User(db, userId)
            .Collection(FirestoreCollections.Billing)
            .Document(FirestoreCollections.BillingAccountDocumentId);

    public static CollectionReference GeneratedCvs(FirestoreDb db) =>
        db.Collection(FirestoreCollections.GeneratedCvs);

    public static CollectionReference LlmUsage(FirestoreDb db) =>
        db.Collection(FirestoreCollections.LlmUsage);

    public static CollectionReference RefreshTokens(FirestoreDb db) =>
        db.Collection(FirestoreCollections.RefreshTokens);

    public static CollectionReference TopUpPayments(FirestoreDb db) =>
        db.Collection(FirestoreCollections.TopUpPayments);

    public static CollectionReference AppSettings(FirestoreDb db) =>
        db.Collection(FirestoreCollections.AppSettings);

    /// <summary>Firestore caps a batch or transaction at 500 writes.</summary>
    public const int MaxWritesPerBatch = 500;
}

public class FirestoreUserRepository(FirestoreDb db) : IUserRepository
{
    public async Task<User?> GetByIdAsync(Guid id, CancellationToken ct = default)
    {
        var snapshot = await FirestorePaths.User(db, id).GetSnapshotAsync(ct);
        return snapshot.Exists ? FirestoreMappers.ToUser(snapshot) : null;
    }

    public Task<User?> GetByEmailAsync(string email, CancellationToken ct = default) =>
        FirstAsync(FirestorePaths.Users(db).WhereEqualTo(FirestoreFields.Email, email), ct);

    public Task<User?> GetByGoogleIdAsync(string googleId, CancellationToken ct = default) =>
        FirstAsync(FirestorePaths.Users(db).WhereEqualTo(FirestoreFields.GoogleId, googleId), ct);

    public async Task<bool> EmailExistsAsync(string email, CancellationToken ct = default)
    {
        // A count() aggregation instead of fetching the document: registration
        // checks this on every attempt and never needs the user itself.
        var snapshot = await FirestorePaths.Users(db)
            .WhereEqualTo(FirestoreFields.Email, email)
            .Aggregate(AggregateField.Count())
            .GetSnapshotAsync(ct);
        return (snapshot.Count ?? 0) > 0;
    }

    public async Task<IReadOnlyList<User>> ListAllAsync(CancellationToken ct = default)
    {
        var snapshot = await FirestorePaths.Users(db).GetSnapshotAsync(ct);
        return snapshot.Documents.Select(FirestoreMappers.ToUser).ToList();
    }

    /// <summary>Creates; fails if a user with that id already exists, as an insert should.</summary>
    public Task AddAsync(User user, CancellationToken ct = default) =>
        FirestorePaths.User(db, user.Id).CreateAsync(FirestoreMappers.FromUser(user), ct);

    /// <summary>
    /// Writes the whole document. EF's equivalent was a no-op SaveChanges over a
    /// tracked entity; entities read from Firestore are detached, so the caller's
    /// mutations only reach the store through a full overwrite here.
    /// </summary>
    public Task UpdateAsync(User user, CancellationToken ct = default) =>
        FirestorePaths.User(db, user.Id).SetAsync(FirestoreMappers.FromUser(user), cancellationToken: ct);

    private static async Task<User?> FirstAsync(Query query, CancellationToken ct)
    {
        var snapshot = await query.Limit(1).GetSnapshotAsync(ct);
        return snapshot.Documents.Count > 0 ? FirestoreMappers.ToUser(snapshot.Documents[0]) : null;
    }
}

public class FirestoreProfileRepository(FirestoreDb db) : IProfileRepository
{
    public async Task<Profile?> GetForUserAsync(Guid id, Guid userId, CancellationToken ct = default)
    {
        // Ownership is the path, so a profile that is not this user's simply
        // does not exist at this address — no second check needed.
        var snapshot = await FirestorePaths.Profile(db, userId, id).GetSnapshotAsync(ct);
        return snapshot.Exists ? FirestoreMappers.ToProfile(snapshot) : null;
    }

    public async Task<IReadOnlyList<Profile>> ListByUserAsync(Guid userId, CancellationToken ct = default)
    {
        var snapshot = await FirestorePaths.Profiles(db, userId).GetSnapshotAsync(ct);
        return snapshot.Documents.Select(FirestoreMappers.ToProfile).ToList();
    }

    public async Task<IReadOnlyDictionary<Guid, int>> CountByUserAsync(
        IReadOnlyCollection<Guid> userIds, CancellationToken ct = default)
    {
        // Server-side count() per user, so the admin list never reads the
        // profile documents themselves. One aggregation per user is the price
        // of having no joins; they are issued together rather than in series.
        var distinct = userIds.Distinct().ToList();
        var counts = await Task.WhenAll(distinct.Select(async userId =>
        {
            var snapshot = await FirestorePaths.Profiles(db, userId)
                .Aggregate(AggregateField.Count())
                .GetSnapshotAsync(ct);
            return (UserId: userId, Count: (int)(snapshot.Count ?? 0));
        }));

        // EF's GroupBy produced no entry for a user with no profiles; matching
        // that keeps callers' "missing means zero" fallbacks correct.
        return counts.Where(c => c.Count > 0).ToDictionary(c => c.UserId, c => c.Count);
    }

    public Task AddAsync(Profile profile, CancellationToken ct = default) =>
        FirestorePaths.Profile(db, profile.UserId, profile.Id)
            .CreateAsync(FirestoreMappers.FromProfile(profile), ct);

    public Task UpdateAsync(Profile profile, CancellationToken ct = default) =>
        FirestorePaths.Profile(db, profile.UserId, profile.Id)
            .SetAsync(FirestoreMappers.FromProfile(profile), cancellationToken: ct);

    public async Task DeleteAsync(Profile profile, CancellationToken ct = default)
    {
        // Postgres cascaded to GeneratedCvs through an ON DELETE CASCADE foreign
        // key. Firestore has no foreign keys, so the cascade is explicit
        // (ADR-0021: "referential integrity becomes a code invariant").
        var cvs = await FirestorePaths.GeneratedCvs(db)
            .WhereEqualTo(FirestoreFields.ProfileId, FirestoreValues.FromGuid(profile.Id))
            .GetSnapshotAsync(ct);

        var targets = cvs.Documents.Select(d => d.Reference).ToList();
        // The profile goes last, so an interrupted cascade leaves orphaned CVs
        // reachable through a profile that still exists, rather than invisible
        // rows under a profile that is already gone.
        targets.Add(FirestorePaths.Profile(db, profile.UserId, profile.Id));

        for (var i = 0; i < targets.Count; i += FirestorePaths.MaxWritesPerBatch)
        {
            var batch = db.StartBatch();
            foreach (var target in targets.Skip(i).Take(FirestorePaths.MaxWritesPerBatch))
                batch.Delete(target);
            await batch.CommitAsync(ct);
        }
    }
}

public class FirestoreGeneratedCvRepository(FirestoreDb db) : IGeneratedCvRepository
{
    public async Task<GeneratedCv?> GetForProfileAsync(Guid id, Guid profileId, CancellationToken ct = default)
    {
        // Top-level, because CvService reaches a CV by (cvId, profileId) and
        // never has the owning user in scope; the profile check is a field
        // comparison on the document it just read.
        var snapshot = await FirestorePaths.GeneratedCvs(db)
            .Document(FirestoreValues.FromGuid(id))
            .GetSnapshotAsync(ct);
        if (!snapshot.Exists)
            return null;

        var cv = FirestoreMappers.ToGeneratedCv(snapshot);
        return cv.ProfileId == profileId ? cv : null;
    }

    public async Task<IReadOnlyList<GeneratedCv>> ListByProfileAsync(Guid profileId, CancellationToken ct = default)
    {
        var snapshot = await FirestorePaths.GeneratedCvs(db)
            .WhereEqualTo(FirestoreFields.ProfileId, FirestoreValues.FromGuid(profileId))
            .GetSnapshotAsync(ct);
        return snapshot.Documents.Select(FirestoreMappers.ToGeneratedCv).ToList();
    }

    public Task AddAsync(GeneratedCv cv, CancellationToken ct = default) =>
        FirestorePaths.GeneratedCvs(db)
            .Document(FirestoreValues.FromGuid(cv.Id))
            .CreateAsync(FirestoreMappers.FromGeneratedCv(cv), ct);

    public Task DeleteAsync(GeneratedCv cv, CancellationToken ct = default) =>
        FirestorePaths.GeneratedCvs(db)
            .Document(FirestoreValues.FromGuid(cv.Id))
            .DeleteAsync(cancellationToken: ct);
}

public class FirestoreLlmUsageRepository(FirestoreDb db) : ILlmUsageRepository
{
    public Task AddAsync(LlmUsage usage, CancellationToken ct = default) =>
        FirestorePaths.LlmUsage(db)
            .Document(FirestoreValues.FromGuid(usage.Id))
            .CreateAsync(FirestoreMappers.FromLlmUsage(usage), ct);

    public async Task<IReadOnlyList<LlmUsage>> ListByUserAsync(Guid userId, CancellationToken ct = default)
    {
        var snapshot = await FirestorePaths.LlmUsage(db)
            .WhereEqualTo(FirestoreFields.UserId, FirestoreValues.FromGuid(userId))
            .GetSnapshotAsync(ct);
        return snapshot.Documents.Select(FirestoreMappers.ToLlmUsage).ToList();
    }

    public async Task<IReadOnlyList<LlmUsage>> ListAllAttributedAsync(CancellationToken ct = default)
    {
        // LlmUsage.UserId is nullable — usage from system calls is recorded with
        // no user and must stay out of the per-user admin rollup. Firestore's
        // != null becomes an IS_NOT_NULL filter, which also excludes documents
        // missing the field entirely.
        var snapshot = await FirestorePaths.LlmUsage(db)
            .WhereNotEqualTo(FirestoreFields.UserId, null)
            .GetSnapshotAsync(ct);
        return snapshot.Documents.Select(FirestoreMappers.ToLlmUsage).ToList();
    }
}

public class FirestoreAppSettingRepository(FirestoreDb db) : IAppSettingRepository
{
    public async Task<AppSetting?> GetAsync(string key, CancellationToken ct = default)
    {
        var snapshot = await FirestorePaths.AppSettings(db).Document(key).GetSnapshotAsync(ct);
        return snapshot.Exists ? FirestoreMappers.ToAppSetting(snapshot) : null;
    }

    /// <summary>
    /// The setting key is the document id, so the read-then-insert-or-update
    /// dance EF needed collapses into one unconditional write.
    /// </summary>
    public Task UpsertAsync(string key, string value, CancellationToken ct = default) =>
        FirestorePaths.AppSettings(db)
            .Document(key)
            .SetAsync(FirestoreMappers.FromAppSetting(value, DateTime.UtcNow), cancellationToken: ct);
}

public class FirestoreRefreshTokenRepository(FirestoreDb db) : IRefreshTokenRepository
{
    public async Task<RefreshToken?> GetByTokenAsync(string tokenHash, CancellationToken ct = default)
    {
        var snapshot = await TokenRef(tokenHash).GetSnapshotAsync(ct);
        return snapshot.Exists ? FirestoreMappers.ToRefreshToken(snapshot) : null;
    }

    public Task AddAsync(RefreshToken token, CancellationToken ct = default) =>
        TokenRef(token.Token).CreateAsync(FirestoreMappers.FromRefreshToken(token), ct);

    public Task UpdateAsync(RefreshToken token, CancellationToken ct = default) =>
        TokenRef(token.Token).SetAsync(FirestoreMappers.FromRefreshToken(token), cancellationToken: ct);

    private DocumentReference TokenRef(string tokenHash) =>
        FirestorePaths.RefreshTokens(db).Document(FirestoreDocumentIds.ForTokenHash(tokenHash));
}

public class FirestoreBillingAccountRepository(FirestoreDb db) : IBillingAccountRepository
{
    public async Task<BillingAccount?> GetByUserAsync(Guid userId, CancellationToken ct = default)
    {
        var snapshot = await FirestorePaths.BillingAccount(db, userId).GetSnapshotAsync(ct);
        return snapshot.Exists ? FirestoreMappers.ToBillingAccount(snapshot) : null;
    }
}

public class FirestoreTopUpPaymentRepository(FirestoreDb db) : ITopUpPaymentRepository
{
    public async Task<TopUpPayment?> GetByIdAsync(Guid id, CancellationToken ct = default)
    {
        var snapshot = await PaymentRef(id).GetSnapshotAsync(ct);
        return snapshot.Exists ? FirestoreMappers.ToTopUpPayment(snapshot) : null;
    }

    public async Task<TopUpPayment?> GetByExternalIdAsync(string externalId, CancellationToken ct = default)
    {
        // Webhooks arrive carrying only the provider's id and no user identity,
        // which is why payments are a top-level collection.
        var snapshot = await FirestorePaths.TopUpPayments(db)
            .WhereEqualTo(FirestoreFields.ExternalId, externalId)
            .Limit(1)
            .GetSnapshotAsync(ct);
        return snapshot.Documents.Count > 0
            ? FirestoreMappers.ToTopUpPayment(snapshot.Documents[0])
            : null;
    }

    public async Task<IReadOnlyList<TopUpPayment>> ListByUserAsync(Guid userId, CancellationToken ct = default)
    {
        var snapshot = await FirestorePaths.TopUpPayments(db)
            .WhereEqualTo(FirestoreFields.UserId, FirestoreValues.FromGuid(userId))
            .GetSnapshotAsync(ct);
        return snapshot.Documents.Select(FirestoreMappers.ToTopUpPayment).ToList();
    }

    public Task AddAsync(TopUpPayment payment, CancellationToken ct = default) =>
        PaymentRef(payment.Id).CreateAsync(FirestoreMappers.FromTopUpPayment(payment), ct);

    public Task UpdateAsync(TopUpPayment payment, CancellationToken ct = default) =>
        PaymentRef(payment.Id).SetAsync(FirestoreMappers.FromTopUpPayment(payment), cancellationToken: ct);

    private DocumentReference PaymentRef(Guid id) =>
        FirestorePaths.TopUpPayments(db).Document(FirestoreValues.FromGuid(id));
}

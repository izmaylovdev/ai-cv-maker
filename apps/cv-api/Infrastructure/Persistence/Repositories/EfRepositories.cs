using CvApi.Domain.Entities;
using CvApi.Domain.Repositories;
using Microsoft.EntityFrameworkCore;

namespace CvApi.Infrastructure.Persistence.Repositories;

// EF Core implementations of the ADR-0021 persistence seam. These exist so the
// seam can be introduced and the call sites/tests migrated while the system
// still runs on Postgres; they are removed once the Firestore implementations
// are green (ADR-0021 decision #3).

public class EfUserRepository(AppDbContext db) : IUserRepository
{
    public Task<User?> GetByIdAsync(Guid id, CancellationToken ct = default) =>
        db.Users.FirstOrDefaultAsync(u => u.Id == id, ct);

    public Task<User?> GetByEmailAsync(string email, CancellationToken ct = default) =>
        db.Users.FirstOrDefaultAsync(u => u.Email == email, ct);

    public Task<User?> GetByGoogleIdAsync(string googleId, CancellationToken ct = default) =>
        db.Users.FirstOrDefaultAsync(u => u.GoogleId == googleId, ct);

    public Task<bool> EmailExistsAsync(string email, CancellationToken ct = default) =>
        db.Users.AnyAsync(u => u.Email == email, ct);

    public async Task<IReadOnlyList<User>> ListAllAsync(CancellationToken ct = default) =>
        await db.Users.ToListAsync(ct);

    public async Task AddAsync(User user, CancellationToken ct = default)
    {
        db.Users.Add(user);
        await db.SaveChangesAsync(ct);
    }

    public async Task UpdateAsync(User user, CancellationToken ct = default) =>
        await db.SaveChangesAsync(ct);
}

public class EfProfileRepository(AppDbContext db) : IProfileRepository
{
    public Task<Profile?> GetForUserAsync(Guid id, Guid userId, CancellationToken ct = default) =>
        db.Profiles.FirstOrDefaultAsync(p => p.Id == id && p.UserId == userId, ct);

    public async Task<IReadOnlyList<Profile>> ListByUserAsync(Guid userId, CancellationToken ct = default) =>
        await db.Profiles.Where(p => p.UserId == userId).ToListAsync(ct);

    public async Task<IReadOnlyDictionary<Guid, int>> CountByUserAsync(
        IReadOnlyCollection<Guid> userIds, CancellationToken ct = default)
    {
        var counts = await db.Profiles
            .Where(p => userIds.Contains(p.UserId))
            .GroupBy(p => p.UserId)
            .Select(g => new { UserId = g.Key, Count = g.Count() })
            .ToListAsync(ct);
        return counts.ToDictionary(c => c.UserId, c => c.Count);
    }

    public async Task AddAsync(Profile profile, CancellationToken ct = default)
    {
        db.Profiles.Add(profile);
        await db.SaveChangesAsync(ct);
    }

    public async Task UpdateAsync(Profile profile, CancellationToken ct = default) =>
        await db.SaveChangesAsync(ct);

    public async Task DeleteAsync(Profile profile, CancellationToken ct = default)
    {
        // The FK cascade handles GeneratedCvs here; the Firestore implementation
        // has to delete them explicitly.
        db.Profiles.Remove(profile);
        await db.SaveChangesAsync(ct);
    }
}

public class EfGeneratedCvRepository(AppDbContext db) : IGeneratedCvRepository
{
    public Task<GeneratedCv?> GetForProfileAsync(Guid id, Guid profileId, CancellationToken ct = default) =>
        db.GeneratedCvs.FirstOrDefaultAsync(g => g.Id == id && g.ProfileId == profileId, ct);

    public async Task<IReadOnlyList<GeneratedCv>> ListByProfileAsync(Guid profileId, CancellationToken ct = default) =>
        await db.GeneratedCvs.Where(g => g.ProfileId == profileId).ToListAsync(ct);

    public async Task AddAsync(GeneratedCv cv, CancellationToken ct = default)
    {
        db.GeneratedCvs.Add(cv);
        await db.SaveChangesAsync(ct);
    }

    public async Task DeleteAsync(GeneratedCv cv, CancellationToken ct = default)
    {
        db.GeneratedCvs.Remove(cv);
        await db.SaveChangesAsync(ct);
    }
}

public class EfLlmUsageRepository(AppDbContext db) : ILlmUsageRepository
{
    public async Task AddAsync(LlmUsage usage, CancellationToken ct = default)
    {
        db.LlmUsages.Add(usage);
        await db.SaveChangesAsync(ct);
    }

    public async Task<IReadOnlyList<LlmUsage>> ListByUserAsync(Guid userId, CancellationToken ct = default) =>
        await db.LlmUsages.Where(u => u.UserId == userId).ToListAsync(ct);

    public async Task<IReadOnlyList<LlmUsage>> ListAllAttributedAsync(CancellationToken ct = default) =>
        await db.LlmUsages.Where(u => u.UserId != null).ToListAsync(ct);
}

public class EfAppSettingRepository(AppDbContext db) : IAppSettingRepository
{
    public Task<AppSetting?> GetAsync(string key, CancellationToken ct = default) =>
        db.AppSettings.FirstOrDefaultAsync(s => s.Key == key, ct);

    public async Task UpsertAsync(string key, string value, CancellationToken ct = default)
    {
        var setting = await db.AppSettings.FirstOrDefaultAsync(s => s.Key == key, ct);
        if (setting is null)
        {
            db.AppSettings.Add(new AppSetting { Key = key, Value = value, UpdatedAt = DateTime.UtcNow });
        }
        else
        {
            setting.Value = value;
            setting.UpdatedAt = DateTime.UtcNow;
        }
        await db.SaveChangesAsync(ct);
    }
}

public class EfRefreshTokenRepository(AppDbContext db) : IRefreshTokenRepository
{
    public Task<RefreshToken?> GetByTokenAsync(string tokenHash, CancellationToken ct = default) =>
        db.RefreshTokens.FirstOrDefaultAsync(r => r.Token == tokenHash, ct);

    public async Task AddAsync(RefreshToken token, CancellationToken ct = default)
    {
        db.RefreshTokens.Add(token);
        await db.SaveChangesAsync(ct);
    }

    public async Task UpdateAsync(RefreshToken token, CancellationToken ct = default) =>
        await db.SaveChangesAsync(ct);
}

public class EfBillingAccountRepository(AppDbContext db) : IBillingAccountRepository
{
    public Task<BillingAccount?> GetByUserAsync(Guid userId, CancellationToken ct = default) =>
        db.BillingAccounts.FirstOrDefaultAsync(b => b.UserId == userId, ct);
}

public class EfTopUpPaymentRepository(AppDbContext db) : ITopUpPaymentRepository
{
    public Task<TopUpPayment?> GetByIdAsync(Guid id, CancellationToken ct = default) =>
        db.TopUpPayments.FirstOrDefaultAsync(p => p.Id == id, ct);

    public Task<TopUpPayment?> GetByExternalIdAsync(string externalId, CancellationToken ct = default) =>
        db.TopUpPayments.FirstOrDefaultAsync(p => p.ExternalId == externalId, ct);

    public async Task<IReadOnlyList<TopUpPayment>> ListByUserAsync(Guid userId, CancellationToken ct = default) =>
        await db.TopUpPayments.Where(p => p.UserId == userId).ToListAsync(ct);

    public async Task AddAsync(TopUpPayment payment, CancellationToken ct = default)
    {
        db.TopUpPayments.Add(payment);
        await db.SaveChangesAsync(ct);
    }

    public async Task UpdateAsync(TopUpPayment payment, CancellationToken ct = default) =>
        await db.SaveChangesAsync(ct);
}

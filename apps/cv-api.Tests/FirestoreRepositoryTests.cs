using CvApi.Domain.Entities;
using CvApi.Infrastructure.Persistence.Firestore;
using Google.Cloud.Firestore;
using Xunit;

namespace CvApi.Tests;

/// <summary>
/// Emulator-backed coverage for the parts of the ADR-0021 Firestore mapping
/// that have no equivalent in Postgres and would fail silently rather than
/// loudly: money that has no native type, Guids and DateTimes that have no
/// native type, the profile document tree that must stay byte-identical to the
/// jsonb column it replaces, the cascade that used to be a foreign key, and the
/// nullable user id on usage rows.
///
/// Skipped when no emulator is configured; see <see cref="FirestoreEmulator"/>.
/// </summary>
public class FirestoreRepositoryTests
{
    private static FirestoreDb Db() => FirestoreEmulator.CreateIsolatedDb();

    // -------------------------------------------------------------------------
    // Type mappings Firestore has no native support for
    // -------------------------------------------------------------------------

    [FirestoreEmulatorTheory]
    [InlineData("0.000001")]      // smallest unit decimal(18,6) can hold
    [InlineData("0.1")]           // not representable exactly as a double
    [InlineData("12345678.901234")]
    [InlineData("20")]
    public async Task Money_RoundTripsExactly(string literal)
    {
        var amount = decimal.Parse(literal, System.Globalization.CultureInfo.InvariantCulture);
        var repo = new FirestoreTopUpPaymentRepository(Db());
        var payment = new TopUpPayment { UserId = Guid.NewGuid(), AmountUsd = amount, Channel = "fake-stripe" };

        await repo.AddAsync(payment);
        var read = await repo.GetByIdAsync(payment.Id);

        Assert.NotNull(read);
        // Not just numerically equal: exact, which a double round trip is not.
        Assert.Equal(amount, read.AmountUsd);
        Assert.Equal(literal, read.AmountUsd.ToString(System.Globalization.CultureInfo.InvariantCulture));
    }

    [FirestoreEmulatorFact]
    public async Task Timestamps_RoundTripAsUtc_PreservingMicroseconds()
    {
        var created = new DateTime(2026, 8, 17, 12, 34, 56, 789, DateTimeKind.Utc).AddTicks(1230);
        var repo = new FirestoreTopUpPaymentRepository(Db());
        var payment = new TopUpPayment
        {
            UserId = Guid.NewGuid(),
            AmountUsd = 5m,
            Channel = "fake-stripe",
            CreatedAt = created,
        };

        await repo.AddAsync(payment);
        var read = await repo.GetByIdAsync(payment.Id);

        Assert.NotNull(read);
        Assert.Equal(DateTimeKind.Utc, read.CreatedAt.Kind);
        Assert.Equal(created, read.CreatedAt);
    }

    [FirestoreEmulatorFact]
    public async Task Timestamps_AcceptUnspecifiedKind_AsUtc()
    {
        // Values that have been through a JSON or HTTP boundary arrive
        // Unspecified. Firestore rejects those outright, so the mapping stamps
        // them rather than letting a write blow up at runtime.
        var created = new DateTime(2026, 8, 17, 12, 34, 56, DateTimeKind.Unspecified);
        var repo = new FirestoreTopUpPaymentRepository(Db());
        var payment = new TopUpPayment
        {
            UserId = Guid.NewGuid(),
            AmountUsd = 5m,
            Channel = "fake-stripe",
            CreatedAt = created,
        };

        await repo.AddAsync(payment);
        var read = await repo.GetByIdAsync(payment.Id);

        Assert.NotNull(read);
        Assert.Equal(DateTime.SpecifyKind(created, DateTimeKind.Utc), read.CreatedAt);
    }

    // -------------------------------------------------------------------------
    // Profile document tree
    // -------------------------------------------------------------------------

    [FirestoreEmulatorFact]
    public async Task ProfileDocument_RoundTripsTheWholeTree()
    {
        var db = Db();
        var repo = new FirestoreProfileRepository(db);
        var userId = Guid.NewGuid();
        var profile = new Profile
        {
            UserId = userId,
            Name = "Backend Engineer",
            Document = ProfileDocument.DefaultTemplate(),
        };
        profile.Document.Header.FullName = "Ada Lovelace";
        profile.Document.Header.Email = "ada@example.com";
        profile.Document.Body.Children[0].Attrs["text"] = "Professional Summary";

        await repo.AddAsync(profile);
        var read = await repo.GetForUserAsync(profile.Id, userId);

        Assert.NotNull(read);
        Assert.Equal(userId, read.UserId);
        Assert.Equal("Backend Engineer", read.Name);
        Assert.Equal("Ada Lovelace", read.Document.Header.FullName);
        Assert.Equal("ada@example.com", read.Document.Header.Email);
        Assert.Equal(
            profile.Document.Body.Children.Count,
            read.Document.Body.Children.Count);
        // The nested timeline → entry → paragraph scaffolding and the
        // Dictionary<string,string> attrs must survive intact.
        var timeline = read.Document.Body.Children[3];
        Assert.Equal("timeline", timeline.Type);
        Assert.Equal("entry", timeline.Children[0].Type);
        Assert.True(timeline.Children[0].Attrs.ContainsKey("dates"));
        Assert.Equal("paragraph", timeline.Children[0].Children[0].Type);
    }

    [FirestoreEmulatorFact]
    public async Task ProfileDocument_IsStoredAsJsonInTheSameShapeAsTheJsonbColumn()
    {
        var db = Db();
        var repo = new FirestoreProfileRepository(db);
        var profile = new Profile { UserId = Guid.NewGuid(), Document = ProfileDocument.DefaultTemplate() };
        await repo.AddAsync(profile);

        var raw = await db.Collection("users").Document(profile.UserId.ToString("D"))
            .Collection("profiles").Document(profile.Id.ToString("D"))
            .GetSnapshotAsync();

        var json = raw.GetValue<string>("document");
        var expected = System.Text.Json.JsonSerializer.Serialize(
            profile.Document, CvApi.Infrastructure.Persistence.ProfileDocumentJson.Options);
        // A straight copy of the Postgres jsonb text has to land as a valid
        // document, so the on-disk form must be the same string.
        Assert.Equal(expected, json);
    }

    [FirestoreEmulatorFact]
    public async Task Profile_IsNotVisibleToAnotherUser()
    {
        var repo = new FirestoreProfileRepository(Db());
        var profile = new Profile { UserId = Guid.NewGuid() };
        await repo.AddAsync(profile);

        Assert.Null(await repo.GetForUserAsync(profile.Id, Guid.NewGuid()));
        Assert.NotNull(await repo.GetForUserAsync(profile.Id, profile.UserId));
    }

    // -------------------------------------------------------------------------
    // The cascade that used to be a foreign key
    // -------------------------------------------------------------------------

    [FirestoreEmulatorFact]
    public async Task DeleteProfile_CascadesToItsGeneratedCvs_AndLeavesOthersAlone()
    {
        var db = Db();
        var profiles = new FirestoreProfileRepository(db);
        var cvs = new FirestoreGeneratedCvRepository(db);

        var userId = Guid.NewGuid();
        var doomed = new Profile { UserId = userId };
        var survivor = new Profile { UserId = userId };
        await profiles.AddAsync(doomed);
        await profiles.AddAsync(survivor);

        await cvs.AddAsync(new GeneratedCv { ProfileId = doomed.Id, FullName = "A" });
        await cvs.AddAsync(new GeneratedCv { ProfileId = doomed.Id, FullName = "B" });
        var kept = new GeneratedCv { ProfileId = survivor.Id, FullName = "C" };
        await cvs.AddAsync(kept);

        await profiles.DeleteAsync(doomed);

        Assert.Null(await profiles.GetForUserAsync(doomed.Id, userId));
        Assert.Empty(await cvs.ListByProfileAsync(doomed.Id));
        Assert.Single(await cvs.ListByProfileAsync(survivor.Id));
        Assert.NotNull(await cvs.GetForProfileAsync(kept.Id, survivor.Id));
    }

    [FirestoreEmulatorFact]
    public async Task GeneratedCv_IsNotReachableThroughTheWrongProfile()
    {
        var cvs = new FirestoreGeneratedCvRepository(Db());
        var cv = new GeneratedCv { ProfileId = Guid.NewGuid(), FullName = "A" };
        await cvs.AddAsync(cv);

        Assert.Null(await cvs.GetForProfileAsync(cv.Id, Guid.NewGuid()));
        Assert.NotNull(await cvs.GetForProfileAsync(cv.Id, cv.ProfileId));
    }

    // -------------------------------------------------------------------------
    // count() aggregation
    // -------------------------------------------------------------------------

    [FirestoreEmulatorFact]
    public async Task CountByUser_CountsServerSide_AndOmitsUsersWithNoProfiles()
    {
        var repo = new FirestoreProfileRepository(Db());
        var busy = Guid.NewGuid();
        var quiet = Guid.NewGuid();
        var empty = Guid.NewGuid();

        await repo.AddAsync(new Profile { UserId = busy });
        await repo.AddAsync(new Profile { UserId = busy });
        await repo.AddAsync(new Profile { UserId = busy });
        await repo.AddAsync(new Profile { UserId = quiet });

        var counts = await repo.CountByUserAsync([busy, quiet, empty]);

        Assert.Equal(3, counts[busy]);
        Assert.Equal(1, counts[quiet]);
        // EF's GroupBy produced no row for a user with none; callers rely on
        // that to fall back to zero.
        Assert.False(counts.ContainsKey(empty));
    }

    // -------------------------------------------------------------------------
    // Nullable LlmUsage.UserId
    // -------------------------------------------------------------------------

    [FirestoreEmulatorFact]
    public async Task UnattributedUsage_IsRecorded_ButExcludedFromTheAttributedRollup()
    {
        var repo = new FirestoreLlmUsageRepository(Db());
        var userId = Guid.NewGuid();

        await repo.AddAsync(new LlmUsage { UserId = userId, Operation = "chat", ModelName = "m", PromptTokens = 10 });
        await repo.AddAsync(new LlmUsage { UserId = null, Operation = "system", ModelName = "m", PromptTokens = 7 });

        var mine = await repo.ListByUserAsync(userId);
        var attributed = await repo.ListAllAttributedAsync();

        Assert.Single(mine);
        Assert.Equal(10, mine[0].PromptTokens);
        // The unattributed row exists but must not appear in the per-user rollup.
        Assert.Single(attributed);
        Assert.Equal(userId, attributed[0].UserId);
    }

    // -------------------------------------------------------------------------
    // Refresh tokens keyed by hash
    // -------------------------------------------------------------------------

    [FirestoreEmulatorFact]
    public async Task RefreshToken_IsKeyedByItsHash_IncludingBase64SlashesAndPluses()
    {
        // AuthService hashes with SHA-256 and base64-encodes, so roughly half of
        // all hashes contain a '/' — which Firestore forbids in a document id.
        const string hash = "a+b/c+d/PLUSandSLASHbearingHash1234567890abc=";
        var repo = new FirestoreRefreshTokenRepository(Db());
        var token = new RefreshToken
        {
            UserId = Guid.NewGuid(),
            Token = hash,
            ExpiresAt = DateTime.UtcNow.AddDays(30),
        };

        await repo.AddAsync(token);
        var read = await repo.GetByTokenAsync(hash);

        Assert.NotNull(read);
        Assert.Equal(hash, read.Token);
        Assert.Equal(token.Id, read.Id);
        Assert.Equal(token.UserId, read.UserId);
        Assert.False(read.IsRevoked);

        read.IsRevoked = true;
        await repo.UpdateAsync(read);
        Assert.True((await repo.GetByTokenAsync(hash))!.IsRevoked);
    }

    [FirestoreEmulatorFact]
    public async Task RefreshToken_MissingHash_ReturnsNull()
    {
        var repo = new FirestoreRefreshTokenRepository(Db());
        Assert.Null(await repo.GetByTokenAsync("no/such+hash="));
    }

    // -------------------------------------------------------------------------
    // Users and settings
    // -------------------------------------------------------------------------

    [FirestoreEmulatorFact]
    public async Task User_IsFoundByIdEmailAndGoogleId_AndUpdatesOverwrite()
    {
        var repo = new FirestoreUserRepository(Db());
        var user = new User
        {
            Email = "ada@example.com",
            GoogleId = "google-123",
            PasswordHash = "hash",
            Country = "UA",
        };
        await repo.AddAsync(user);

        Assert.Equal(user.Id, (await repo.GetByIdAsync(user.Id))!.Id);
        Assert.Equal(user.Id, (await repo.GetByEmailAsync("ada@example.com"))!.Id);
        Assert.Equal(user.Id, (await repo.GetByGoogleIdAsync("google-123"))!.Id);
        Assert.True(await repo.EmailExistsAsync("ada@example.com"));
        Assert.False(await repo.EmailExistsAsync("nobody@example.com"));

        var loaded = await repo.GetByIdAsync(user.Id);
        loaded!.Country = "PL";
        loaded.GlobalPreferences = "{\"tone\":\"formal\"}";
        await repo.UpdateAsync(loaded);

        var reloaded = await repo.GetByIdAsync(user.Id);
        Assert.Equal("PL", reloaded!.Country);
        Assert.Equal("{\"tone\":\"formal\"}", reloaded.GlobalPreferences);
        Assert.Equal("hash", reloaded.PasswordHash);
    }

    [FirestoreEmulatorFact]
    public async Task AppSetting_UpsertsUnderItsKey()
    {
        var repo = new FirestoreAppSettingRepository(Db());
        Assert.Null(await repo.GetAsync("LlmUsageLimitUsd"));

        await repo.UpsertAsync("LlmUsageLimitUsd", "1.25");
        Assert.Equal("1.25", (await repo.GetAsync("LlmUsageLimitUsd"))!.Value);

        await repo.UpsertAsync("LlmUsageLimitUsd", "2.50");
        Assert.Equal("2.50", (await repo.GetAsync("LlmUsageLimitUsd"))!.Value);
    }

    [FirestoreEmulatorFact]
    public async Task TopUpPayment_IsFoundByExternalId_AndListedPerUser()
    {
        var repo = new FirestoreTopUpPaymentRepository(Db());
        var userId = Guid.NewGuid();
        var payment = new TopUpPayment
        {
            UserId = userId,
            AmountUsd = 10m,
            Channel = "stripe",
            ExternalId = "cs_test_123",
        };
        await repo.AddAsync(payment);
        await repo.AddAsync(new TopUpPayment { UserId = Guid.NewGuid(), AmountUsd = 5m, Channel = "stripe" });

        Assert.Equal(payment.Id, (await repo.GetByExternalIdAsync("cs_test_123"))!.Id);
        Assert.Null(await repo.GetByExternalIdAsync("cs_test_missing"));
        Assert.Single(await repo.ListByUserAsync(userId));

        var loaded = await repo.GetByIdAsync(payment.Id);
        loaded!.Status = TopUpStatus.Paid;
        await repo.UpdateAsync(loaded);
        Assert.Equal(TopUpStatus.Paid, (await repo.GetByIdAsync(payment.Id))!.Status);
    }

    [FirestoreEmulatorFact]
    public async Task BillingAccount_IsAbsentUntilCreated()
    {
        var repo = new FirestoreBillingAccountRepository(Db());
        Assert.Null(await repo.GetByUserAsync(Guid.NewGuid()));
    }
}

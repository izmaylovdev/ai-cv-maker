using System.Globalization;
using System.Text.Json;
using CvApi.Domain.Entities;
using Google.Cloud.Firestore;

namespace CvApi.Infrastructure.Persistence.Firestore;

/// <summary>
/// The ADR-0021 collection layout, in one place. Nesting follows the key the
/// application looks a document up by, not the relational foreign key: only
/// Profile and BillingAccount are reached with the user id already in hand.
/// </summary>
internal static class FirestoreCollections
{
    public const string Users = "users";

    /// <summary>Subcollection of <c>users/{userId}</c>.</summary>
    public const string Profiles = "profiles";

    /// <summary>Subcollection of <c>users/{userId}</c>, holding exactly one document.</summary>
    public const string Billing = "billing";

    /// <summary>
    /// Fixed id of the single document in <c>users/{userId}/billing</c>. A fixed
    /// id makes "does this user have a billing account?" a keyed read rather
    /// than a query — which is what the confirmation transaction needs.
    /// </summary>
    public const string BillingAccountDocumentId = "account";

    public const string GeneratedCvs = "generatedCvs";
    public const string LlmUsage = "llmUsage";
    public const string RefreshTokens = "refreshTokens";
    public const string TopUpPayments = "topUpPayments";
    public const string AppSettings = "appSettings";
}

/// <summary>
/// Field names of the stored documents. Constants rather than literals because
/// the same names appear in both the mappers and the query filters, and a typo
/// in one of the two is a silent empty result rather than a compile error.
/// </summary>
internal static class FirestoreFields
{
    // Shared
    public const string UserId = "userId";
    public const string CreatedAt = "createdAt";
    public const string UpdatedAt = "updatedAt";

    // User
    public const string Email = "email";
    public const string PasswordHash = "passwordHash";
    public const string GoogleId = "googleId";
    public const string GlobalPreferences = "globalPreferences";
    public const string Country = "country";

    // Profile
    public const string Name = "name";
    public const string Document = "document";

    // GeneratedCv
    public const string ProfileId = "profileId";
    public const string OptimizationNotes = "optimizationNotes";
    public const string FullName = "fullName";
    public const string Title = "title";
    public const string Location = "location";
    public const string ContactEmail = "contactEmail";
    public const string ContactPhone = "contactPhone";
    public const string CvDataJson = "cvDataJson";

    // LlmUsage
    public const string Operation = "operation";
    public const string PromptTokens = "promptTokens";
    public const string CompletionTokens = "completionTokens";
    public const string CacheReadTokens = "cacheReadTokens";
    public const string CacheWriteTokens = "cacheWriteTokens";
    public const string ModelName = "modelName";

    // AppSetting / RefreshToken
    public const string Value = "value";
    public const string Id = "id";
    public const string Token = "token";
    public const string ExpiresAt = "expiresAt";
    public const string IsRevoked = "isRevoked";

    // BillingAccount / TopUpPayment
    public const string AllowanceUsd = "allowanceUsd";
    public const string Currency = "currency";
    public const string AmountUsd = "amountUsd";
    public const string Channel = "channel";
    public const string Status = "status";
    public const string ExternalId = "externalId";
}

/// <summary>
/// Conversions between the domain's CLR types and the value types Firestore
/// actually has. Every one of these is a place where a careless mapping would
/// lose data, so they live together and are used by every mapper.
/// </summary>
internal static class FirestoreValues
{
    /// <summary>
    /// Money (<c>BillingAccount.AllowanceUsd</c>, <c>TopUpPayment.AmountUsd</c>,
    /// both <c>decimal(18,6)</c> in Postgres) is stored as an
    /// <b>invariant-culture string</b>.
    ///
    /// Firestore's value model has no decimal — its numeric types are int64 and
    /// IEEE-754 double — and a double round trip is lossy at six decimal places,
    /// which for a balance means real money quietly drifting. A string is exact
    /// in both directions and is the same text Postgres exports, so the data
    /// migration is a straight copy rather than a re-encoding. Neither field is
    /// ever range-queried or ordered on, so losing numeric sortability in the
    /// index costs nothing.
    /// </summary>
    public static string FromDecimal(decimal value) => value.ToString(CultureInfo.InvariantCulture);

    public static decimal ReadDecimal(DocumentSnapshot snapshot, string field)
    {
        var raw = ReadString(snapshot, field);
        return string.IsNullOrEmpty(raw)
            ? 0m
            : decimal.Parse(raw, NumberStyles.Number, CultureInfo.InvariantCulture);
    }

    /// <summary>
    /// Guids are stored as strings in the "D" (hyphenated, lowercase) format —
    /// the one format used everywhere, including document ids, so a document id
    /// and a foreign-key field holding the same entity compare equal as text.
    /// </summary>
    public static string FromGuid(Guid value) => value.ToString("D");

    public static Guid ReadGuid(DocumentSnapshot snapshot, string field)
    {
        var raw = ReadString(snapshot, field);
        return string.IsNullOrEmpty(raw) ? Guid.Empty : Guid.Parse(raw);
    }

    public static Guid? ReadNullableGuid(DocumentSnapshot snapshot, string field)
    {
        var raw = ReadString(snapshot, field);
        return string.IsNullOrEmpty(raw) ? null : Guid.Parse(raw);
    }

    /// <summary>
    /// Firestore rejects a <see cref="DateTime"/> that is not
    /// <see cref="DateTimeKind.Utc"/>. Entities default their timestamps with
    /// <c>DateTime.UtcNow</c>, but values that have been through a JSON or HTTP
    /// boundary arrive as Unspecified — those are already UTC by convention, so
    /// they are stamped rather than shifted. Timestamps come back as UTC.
    /// </summary>
    public static DateTime ToUtc(DateTime value) => value.Kind switch
    {
        DateTimeKind.Utc => value,
        DateTimeKind.Local => value.ToUniversalTime(),
        _ => DateTime.SpecifyKind(value, DateTimeKind.Utc),
    };

    public static Timestamp FromDateTime(DateTime value) => Timestamp.FromDateTime(ToUtc(value));

    public static DateTime ReadDateTime(DocumentSnapshot snapshot, string field) =>
        snapshot.TryGetValue<Timestamp>(field, out var timestamp)
            ? timestamp.ToDateTime()
            : default;

    public static string? ReadString(DocumentSnapshot snapshot, string field) =>
        snapshot.TryGetValue<string>(field, out var value) ? value : null;

    public static int ReadInt(DocumentSnapshot snapshot, string field) =>
        snapshot.TryGetValue<int>(field, out var value) ? value : 0;

    public static bool ReadBool(DocumentSnapshot snapshot, string field) =>
        snapshot.TryGetValue<bool>(field, out var value) && value;
}

/// <summary>
/// Document ↔ entity mapping. Written by hand rather than with
/// <c>[FirestoreData]</c> attributes so the domain entities stay free of
/// persistence concerns, and so the decimal/Guid/DateTime decisions above are
/// applied in exactly one place.
///
/// Ids that are carried by the document path (a user's id, a profile's owner,
/// a setting's key, a refresh token's hash) are not duplicated into fields —
/// the path is the single source of truth for them.
/// </summary>
internal static class FirestoreMappers
{
    public static Dictionary<string, object?> FromUser(User user) => new()
    {
        [FirestoreFields.Email] = user.Email,
        [FirestoreFields.PasswordHash] = user.PasswordHash,
        [FirestoreFields.GoogleId] = user.GoogleId,
        [FirestoreFields.CreatedAt] = FirestoreValues.FromDateTime(user.CreatedAt),
        [FirestoreFields.GlobalPreferences] = user.GlobalPreferences,
        [FirestoreFields.Country] = user.Country,
    };

    public static User ToUser(DocumentSnapshot snapshot) => new()
    {
        Id = Guid.Parse(snapshot.Id),
        Email = FirestoreValues.ReadString(snapshot, FirestoreFields.Email) ?? string.Empty,
        PasswordHash = FirestoreValues.ReadString(snapshot, FirestoreFields.PasswordHash),
        GoogleId = FirestoreValues.ReadString(snapshot, FirestoreFields.GoogleId),
        CreatedAt = FirestoreValues.ReadDateTime(snapshot, FirestoreFields.CreatedAt),
        GlobalPreferences = FirestoreValues.ReadString(snapshot, FirestoreFields.GlobalPreferences),
        Country = FirestoreValues.ReadString(snapshot, FirestoreFields.Country),
    };

    /// <summary>
    /// The recursive ProfileDocument tree is stored as a single JSON string
    /// using <see cref="ProfileDocumentJson.Options"/> — byte-identical to the
    /// Postgres <c>jsonb</c> column it replaces, so the data migration copies
    /// the text across unchanged. Mapping the tree onto nested Firestore maps
    /// would hit the 20-level nesting limit, cost an index entry per leaf, and
    /// give a different on-disk shape for no benefit.
    /// </summary>
    public static Dictionary<string, object?> FromProfile(Profile profile) => new()
    {
        [FirestoreFields.Name] = profile.Name,
        [FirestoreFields.Document] = JsonSerializer.Serialize(profile.Document, ProfileDocumentJson.Options),
    };

    public static Profile ToProfile(DocumentSnapshot snapshot)
    {
        var json = FirestoreValues.ReadString(snapshot, FirestoreFields.Document);
        return new Profile
        {
            Id = Guid.Parse(snapshot.Id),
            // users/{userId}/profiles/{profileId} — the grandparent document is the owner.
            UserId = Guid.Parse(snapshot.Reference.Parent.Parent!.Id),
            Name = FirestoreValues.ReadString(snapshot, FirestoreFields.Name) ?? "My Profile",
            Document = string.IsNullOrEmpty(json)
                ? ProfileDocument.Empty()
                : JsonSerializer.Deserialize<ProfileDocument>(json, ProfileDocumentJson.Options)
                  ?? ProfileDocument.Empty(),
        };
    }

    public static Dictionary<string, object?> FromGeneratedCv(GeneratedCv cv) => new()
    {
        [FirestoreFields.ProfileId] = FirestoreValues.FromGuid(cv.ProfileId),
        [FirestoreFields.CreatedAt] = FirestoreValues.FromDateTime(cv.CreatedAt),
        [FirestoreFields.OptimizationNotes] = cv.OptimizationNotes,
        [FirestoreFields.FullName] = cv.FullName,
        [FirestoreFields.Title] = cv.Title,
        [FirestoreFields.Location] = cv.Location,
        [FirestoreFields.ContactEmail] = cv.ContactEmail,
        [FirestoreFields.ContactPhone] = cv.ContactPhone,
        [FirestoreFields.CvDataJson] = cv.CvDataJson,
    };

    public static GeneratedCv ToGeneratedCv(DocumentSnapshot snapshot) => new()
    {
        Id = Guid.Parse(snapshot.Id),
        ProfileId = FirestoreValues.ReadGuid(snapshot, FirestoreFields.ProfileId),
        CreatedAt = FirestoreValues.ReadDateTime(snapshot, FirestoreFields.CreatedAt),
        OptimizationNotes = FirestoreValues.ReadString(snapshot, FirestoreFields.OptimizationNotes),
        FullName = FirestoreValues.ReadString(snapshot, FirestoreFields.FullName) ?? string.Empty,
        Title = FirestoreValues.ReadString(snapshot, FirestoreFields.Title) ?? string.Empty,
        Location = FirestoreValues.ReadString(snapshot, FirestoreFields.Location),
        ContactEmail = FirestoreValues.ReadString(snapshot, FirestoreFields.ContactEmail),
        ContactPhone = FirestoreValues.ReadString(snapshot, FirestoreFields.ContactPhone),
        CvDataJson = FirestoreValues.ReadString(snapshot, FirestoreFields.CvDataJson) ?? "{}",
    };

    /// <summary>
    /// <c>userId</c> is written even when null: unattributed system calls are
    /// real rows, and <c>ListAllAttributedAsync</c> filters them out with an
    /// <c>!= null</c> filter, which needs the field to be present.
    /// </summary>
    public static Dictionary<string, object?> FromLlmUsage(LlmUsage usage) => new()
    {
        [FirestoreFields.UserId] = usage.UserId is Guid userId ? FirestoreValues.FromGuid(userId) : null,
        [FirestoreFields.Operation] = usage.Operation,
        [FirestoreFields.PromptTokens] = usage.PromptTokens,
        [FirestoreFields.CompletionTokens] = usage.CompletionTokens,
        [FirestoreFields.CacheReadTokens] = usage.CacheReadTokens,
        [FirestoreFields.CacheWriteTokens] = usage.CacheWriteTokens,
        [FirestoreFields.ModelName] = usage.ModelName,
        [FirestoreFields.CreatedAt] = FirestoreValues.FromDateTime(usage.CreatedAt),
    };

    public static LlmUsage ToLlmUsage(DocumentSnapshot snapshot) => new()
    {
        Id = Guid.Parse(snapshot.Id),
        UserId = FirestoreValues.ReadNullableGuid(snapshot, FirestoreFields.UserId),
        Operation = FirestoreValues.ReadString(snapshot, FirestoreFields.Operation) ?? string.Empty,
        PromptTokens = FirestoreValues.ReadInt(snapshot, FirestoreFields.PromptTokens),
        CompletionTokens = FirestoreValues.ReadInt(snapshot, FirestoreFields.CompletionTokens),
        CacheReadTokens = FirestoreValues.ReadInt(snapshot, FirestoreFields.CacheReadTokens),
        CacheWriteTokens = FirestoreValues.ReadInt(snapshot, FirestoreFields.CacheWriteTokens),
        ModelName = FirestoreValues.ReadString(snapshot, FirestoreFields.ModelName) ?? string.Empty,
        CreatedAt = FirestoreValues.ReadDateTime(snapshot, FirestoreFields.CreatedAt),
    };

    public static Dictionary<string, object?> FromAppSetting(string value, DateTime updatedAt) => new()
    {
        [FirestoreFields.Value] = value,
        [FirestoreFields.UpdatedAt] = FirestoreValues.FromDateTime(updatedAt),
    };

    public static AppSetting ToAppSetting(DocumentSnapshot snapshot) => new()
    {
        Key = snapshot.Id,
        Value = FirestoreValues.ReadString(snapshot, FirestoreFields.Value) ?? string.Empty,
        UpdatedAt = FirestoreValues.ReadDateTime(snapshot, FirestoreFields.UpdatedAt),
    };

    /// <summary>
    /// The token hash is the document id, but it is also kept as a field: the id
    /// is URL-safe-encoded (see <see cref="FirestoreDocumentIds.ForTokenHash"/>)
    /// and the field holds the original hash, so a document is readable without
    /// reversing the encoding.
    /// </summary>
    public static Dictionary<string, object?> FromRefreshToken(RefreshToken token) => new()
    {
        [FirestoreFields.Id] = FirestoreValues.FromGuid(token.Id),
        [FirestoreFields.UserId] = FirestoreValues.FromGuid(token.UserId),
        [FirestoreFields.Token] = token.Token,
        [FirestoreFields.ExpiresAt] = FirestoreValues.FromDateTime(token.ExpiresAt),
        [FirestoreFields.CreatedAt] = FirestoreValues.FromDateTime(token.CreatedAt),
        [FirestoreFields.IsRevoked] = token.IsRevoked,
    };

    public static RefreshToken ToRefreshToken(DocumentSnapshot snapshot) => new()
    {
        Id = FirestoreValues.ReadGuid(snapshot, FirestoreFields.Id),
        UserId = FirestoreValues.ReadGuid(snapshot, FirestoreFields.UserId),
        Token = FirestoreValues.ReadString(snapshot, FirestoreFields.Token) ?? string.Empty,
        ExpiresAt = FirestoreValues.ReadDateTime(snapshot, FirestoreFields.ExpiresAt),
        CreatedAt = FirestoreValues.ReadDateTime(snapshot, FirestoreFields.CreatedAt),
        IsRevoked = FirestoreValues.ReadBool(snapshot, FirestoreFields.IsRevoked),
    };

    public static Dictionary<string, object?> FromBillingAccount(BillingAccount account) => new()
    {
        [FirestoreFields.Id] = FirestoreValues.FromGuid(account.Id),
        [FirestoreFields.AllowanceUsd] = FirestoreValues.FromDecimal(account.AllowanceUsd),
        [FirestoreFields.Currency] = account.Currency,
        [FirestoreFields.UpdatedAt] = FirestoreValues.FromDateTime(account.UpdatedAt),
    };

    public static BillingAccount ToBillingAccount(DocumentSnapshot snapshot) => new()
    {
        Id = FirestoreValues.ReadGuid(snapshot, FirestoreFields.Id),
        // users/{userId}/billing/account — the grandparent document is the owner.
        UserId = Guid.Parse(snapshot.Reference.Parent.Parent!.Id),
        AllowanceUsd = FirestoreValues.ReadDecimal(snapshot, FirestoreFields.AllowanceUsd),
        Currency = FirestoreValues.ReadString(snapshot, FirestoreFields.Currency) ?? "USD",
        UpdatedAt = FirestoreValues.ReadDateTime(snapshot, FirestoreFields.UpdatedAt),
    };

    public static Dictionary<string, object?> FromTopUpPayment(TopUpPayment payment) => new()
    {
        [FirestoreFields.UserId] = FirestoreValues.FromGuid(payment.UserId),
        [FirestoreFields.AmountUsd] = FirestoreValues.FromDecimal(payment.AmountUsd),
        [FirestoreFields.Channel] = payment.Channel,
        [FirestoreFields.Status] = payment.Status,
        [FirestoreFields.ExternalId] = payment.ExternalId,
        [FirestoreFields.CreatedAt] = FirestoreValues.FromDateTime(payment.CreatedAt),
        [FirestoreFields.UpdatedAt] = FirestoreValues.FromDateTime(payment.UpdatedAt),
    };

    public static TopUpPayment ToTopUpPayment(DocumentSnapshot snapshot) => new()
    {
        Id = Guid.Parse(snapshot.Id),
        UserId = FirestoreValues.ReadGuid(snapshot, FirestoreFields.UserId),
        AmountUsd = FirestoreValues.ReadDecimal(snapshot, FirestoreFields.AmountUsd),
        Channel = FirestoreValues.ReadString(snapshot, FirestoreFields.Channel) ?? string.Empty,
        Status = FirestoreValues.ReadString(snapshot, FirestoreFields.Status) ?? TopUpStatus.Pending,
        ExternalId = FirestoreValues.ReadString(snapshot, FirestoreFields.ExternalId),
        CreatedAt = FirestoreValues.ReadDateTime(snapshot, FirestoreFields.CreatedAt),
        UpdatedAt = FirestoreValues.ReadDateTime(snapshot, FirestoreFields.UpdatedAt),
    };
}

/// <summary>Document-id encoding for keys that are not already Firestore-safe.</summary>
internal static class FirestoreDocumentIds
{
    /// <summary>
    /// Refresh tokens are keyed by their hash so the hottest auth lookup is a
    /// single keyed get with no query and no index (ADR-0021). The hash is a
    /// base64 SHA-256 (<c>AuthService.HashToken</c>), and base64's alphabet
    /// includes <c>/</c> — which Firestore treats as a path separator and
    /// forbids in a document id, plus <c>+</c> which is merely awkward in a
    /// path. The id is therefore the base64url form of the same hash: a
    /// one-to-one character substitution, so it stays collision-free and the
    /// lookup stays a keyed read. The unmodified hash is kept in the
    /// <c>token</c> field.
    /// </summary>
    public static string ForTokenHash(string tokenHash) =>
        tokenHash.Replace('+', '-').Replace('/', '_');
}

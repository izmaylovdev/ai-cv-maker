using CvApi.Domain.Repositories;
using Google.Api.Gax;
using Google.Cloud.Firestore;

namespace CvApi.Infrastructure.Persistence.Firestore;

/// <summary>
/// Which implementation of the ADR-0021 seam the process runs on. Postgres is
/// the default so that adding the Firestore implementations changes nothing
/// until the provider is switched deliberately.
/// </summary>
public static class PersistenceProviders
{
    public const string SectionKey = "Persistence:Provider";
    public const string Postgres = "Postgres";
    public const string Firestore = "Firestore";

    public static bool UseFirestore(IConfiguration configuration) =>
        string.Equals(configuration[SectionKey], Firestore, StringComparison.OrdinalIgnoreCase);
}

public class FirestoreOptions
{
    public const string SectionName = "Firestore";

    /// <summary>
    /// GCP project holding the database. Falls back to GOOGLE_CLOUD_PROJECT,
    /// which is also what the emulator convention expects (the emulator itself
    /// accepts any project id and creates it on first write).
    /// </summary>
    public string? ProjectId { get; set; }

    /// <summary>
    /// Firestore database id. Null means the project default — the only
    /// free-tier-eligible database, which is the one ADR-0021 decision #1 uses.
    /// </summary>
    public string? DatabaseId { get; set; }
}

public static class FirestorePersistenceServiceCollectionExtensions
{
    /// <summary>
    /// Registers the Firestore implementations of every seam interface.
    ///
    /// <see cref="FirestoreDb"/> is a singleton: it owns a pooled gRPC channel
    /// and is thread-safe, so one per process is both correct and what keeps
    /// the connection count sane on Cloud Run. The repositories stay scoped to
    /// match the EF registrations they stand in for.
    /// </summary>
    public static IServiceCollection AddFirestorePersistence(
        this IServiceCollection services, IConfiguration configuration)
    {
        services.Configure<FirestoreOptions>(configuration.GetSection(FirestoreOptions.SectionName));

        services.AddSingleton(_ =>
        {
            var options = configuration.GetSection(FirestoreOptions.SectionName).Get<FirestoreOptions>()
                          ?? new FirestoreOptions();

            var projectId = options.ProjectId
                ?? Environment.GetEnvironmentVariable("GOOGLE_CLOUD_PROJECT")
                ?? throw new InvalidOperationException(
                    "Firestore:ProjectId (or GOOGLE_CLOUD_PROJECT) must be set when "
                    + $"{PersistenceProviders.SectionKey} is {PersistenceProviders.Firestore}.");

            var dbBuilder = new FirestoreDbBuilder
            {
                ProjectId = projectId,
                // Honour FIRESTORE_EMULATOR_HOST when it is set (local dev,
                // tests) and use real credentials otherwise, so the same image
                // runs against the emulator and against production.
                EmulatorDetection = EmulatorDetection.EmulatorOrProduction,
            };
            if (!string.IsNullOrWhiteSpace(options.DatabaseId))
                dbBuilder.DatabaseId = options.DatabaseId;

            return dbBuilder.Build();
        });

        services.AddScoped<IUserRepository, FirestoreUserRepository>();
        services.AddScoped<IProfileRepository, FirestoreProfileRepository>();
        services.AddScoped<IGeneratedCvRepository, FirestoreGeneratedCvRepository>();
        services.AddScoped<ILlmUsageRepository, FirestoreLlmUsageRepository>();
        services.AddScoped<IAppSettingRepository, FirestoreAppSettingRepository>();
        services.AddScoped<IRefreshTokenRepository, FirestoreRefreshTokenRepository>();
        services.AddScoped<IBillingAccountRepository, FirestoreBillingAccountRepository>();
        services.AddScoped<ITopUpPaymentRepository, FirestoreTopUpPaymentRepository>();
        services.AddScoped<IPaymentConfirmationStore, FirestorePaymentConfirmationStore>();

        return services;
    }
}

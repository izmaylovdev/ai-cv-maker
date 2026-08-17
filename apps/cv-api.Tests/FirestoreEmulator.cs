using Google.Api.Gax;
using Google.Cloud.Firestore;
using Xunit;

namespace CvApi.Tests;

/// <summary>
/// Access to a local Firestore emulator for the tests that exercise the real
/// Firestore implementations of the ADR-0021 seam.
///
/// Start one with:
/// <code>
/// gcloud emulators firestore start --host-port=127.0.0.1:8912
/// export FIRESTORE_EMULATOR_HOST=127.0.0.1:8912
/// </code>
/// (the emulator needs a Java 21+ JRE on PATH). Without that variable the
/// emulator-backed tests are skipped rather than failed, so the suite still
/// runs on a machine — or a CI job — that has no emulator.
/// </summary>
public static class FirestoreEmulator
{
    public const string HostVariable = "FIRESTORE_EMULATOR_HOST";

    public static bool IsAvailable =>
        !string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(HostVariable));

    /// <summary>
    /// A database in a project id nothing else uses, so tests that assert over
    /// whole collections ("no billing account was created anywhere") cannot see
    /// each other's documents. The emulator creates projects on first write, so
    /// this needs no setup and no teardown.
    /// </summary>
    public static FirestoreDb CreateIsolatedDb() => new FirestoreDbBuilder
    {
        ProjectId = "cvapitest-" + Guid.NewGuid().ToString("n")[..12],
        EmulatorDetection = EmulatorDetection.EmulatorOnly,
    }.Build();
}

/// <summary>
/// <see cref="FactAttribute"/> that skips when no emulator is configured. The
/// skip is decided at discovery time because xUnit v2 has no runtime skip.
/// </summary>
public sealed class FirestoreEmulatorFactAttribute : FactAttribute
{
    public FirestoreEmulatorFactAttribute()
    {
        if (!FirestoreEmulator.IsAvailable)
            Skip = $"Firestore emulator not configured ({FirestoreEmulator.HostVariable} is unset).";
    }
}

/// <inheritdoc cref="FirestoreEmulatorFactAttribute"/>
public sealed class FirestoreEmulatorTheoryAttribute : TheoryAttribute
{
    public FirestoreEmulatorTheoryAttribute()
    {
        if (!FirestoreEmulator.IsAvailable)
            Skip = $"Firestore emulator not configured ({FirestoreEmulator.HostVariable} is unset).";
    }
}

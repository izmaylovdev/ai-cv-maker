using Google.Apis.Auth.OAuth2;
using Grpc.Core;

namespace CvApi.Infrastructure.ExternalServices.Llm;

/// <summary>
/// Supplies the per-call identity token for llm-service gRPC calls.
/// See ADR-0001: enforcement happens at the Cloud Run edge (IAM), so the only
/// job here is attaching a Google-signed ID token when running on GCP.
/// </summary>
public interface ILlmCallTokenProvider
{
    Task<string?> GetTokenAsync(CancellationToken cancellationToken);
}

/// <summary>Local/dev mode: no token, plaintext gRPC stays untouched.</summary>
public sealed class NullLlmCallTokenProvider : ILlmCallTokenProvider
{
    public Task<string?> GetTokenAsync(CancellationToken cancellationToken) =>
        Task.FromResult<string?>(null);
}

/// <summary>
/// Fetches a Google-signed OIDC ID token for the llm-service audience via
/// Application Default Credentials (the metadata server on Cloud Run).
/// </summary>
public sealed class GoogleIdTokenProvider(string audience) : ILlmCallTokenProvider
{
    private readonly SemaphoreSlim _initLock = new(1, 1);
    private OidcToken? _oidcToken;

    public async Task<string?> GetTokenAsync(CancellationToken cancellationToken)
    {
        if (_oidcToken is null)
        {
            await _initLock.WaitAsync(cancellationToken);
            try
            {
                _oidcToken ??= await (await GoogleCredential.GetApplicationDefaultAsync(cancellationToken))
                    .GetOidcTokenAsync(OidcTokenOptions.FromTargetAudience(audience), cancellationToken);
            }
            finally
            {
                _initLock.Release();
            }
        }

        // OidcToken caches the signed JWT internally and refreshes it near expiry.
        return await _oidcToken.GetAccessTokenAsync(cancellationToken);
    }
}

public static class LlmCallAuth
{
    public static ILlmCallTokenProvider CreateTokenProvider(string? authMode, string audience)
    {
        var mode = (authMode ?? "none").Trim().ToLowerInvariant();
        return mode switch
        {
            "" or "none" => new NullLlmCallTokenProvider(),
            "google" => string.IsNullOrWhiteSpace(audience)
                ? throw new InvalidOperationException(
                    "LlmService:GrpcUrl must be configured when LlmService:AuthMode is 'google'.")
                : new GoogleIdTokenProvider(audience),
            _ => throw new InvalidOperationException(
                $"Unknown LlmService:AuthMode '{authMode}'. Valid values: none, google."),
        };
    }

    public static async Task ApplyAsync(
        ILlmCallTokenProvider provider, Metadata metadata, CancellationToken cancellationToken)
    {
        var token = await provider.GetTokenAsync(cancellationToken);
        if (!string.IsNullOrEmpty(token))
            metadata.Add("Authorization", $"Bearer {token}");
    }
}

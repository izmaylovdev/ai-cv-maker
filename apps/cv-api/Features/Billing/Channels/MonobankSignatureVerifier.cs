using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.Extensions.Options;

namespace CvApi.Features.Billing.Channels;

/// <summary>
/// Verifies Monobank webhook signatures (US-BILL-1): the <c>X-Sign</c> header
/// carries a base64 ECDSA-SHA256 signature of the raw request body, checked
/// against the merchant public key fetched once from
/// <c>GET /api/merchant/pubkey</c> and cached in memory for the process
/// lifetime. Registered as a singleton so the cache is shared.
/// </summary>
public class MonobankSignatureVerifier(
    IHttpClientFactory httpClientFactory,
    IOptions<PaymentsOptions> options)
{
    private const string PubKeyUrl = "https://api.monobank.ua/api/merchant/pubkey";

    private readonly SemaphoreSlim _keyLock = new(1, 1);
    private string? _cachedKeyPem;

    public async Task<bool> VerifyAsync(string signatureBase64, byte[] body, CancellationToken ct)
    {
        try
        {
            var pem = await GetPublicKeyPemAsync(ct);
            using var ecdsa = ECDsa.Create();
            ecdsa.ImportFromPem(pem);
            return ecdsa.VerifyData(
                body,
                Convert.FromBase64String(signatureBase64),
                HashAlgorithmName.SHA256,
                DSASignatureFormat.Rfc3279DerSequence);
        }
        catch
        {
            // Any failure (malformed base64, unreachable pubkey endpoint, bad
            // key) means the signature cannot be trusted → treat as invalid.
            return false;
        }
    }

    private async Task<string> GetPublicKeyPemAsync(CancellationToken ct)
    {
        if (_cachedKeyPem is not null)
            return _cachedKeyPem;

        await _keyLock.WaitAsync(ct);
        try
        {
            if (_cachedKeyPem is not null)
                return _cachedKeyPem;

            var request = new HttpRequestMessage(HttpMethod.Get, PubKeyUrl);
            request.Headers.Add("X-Token", options.Value.Monobank.Token);

            var client = httpClientFactory.CreateClient(nameof(MonobankSignatureVerifier));
            var response = await client.SendAsync(request, ct);
            response.EnsureSuccessStatusCode();

            // Response: { "key": "<base64-encoded PEM public key>" }
            using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(ct));
            var keyBase64 = json.RootElement.GetProperty("key").GetString()
                ?? throw new InvalidOperationException("Monobank pubkey response has no key.");

            _cachedKeyPem = System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(keyBase64));
            return _cachedKeyPem;
        }
        finally
        {
            _keyLock.Release();
        }
    }
}

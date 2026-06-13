using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace CvApi.Features.Admin;

/// <summary>
/// Guards the service-to-service admin endpoints with a shared API key
/// (ADR-0005). These routes are NOT behind the user JWT scheme; the only caller
/// is admin-api, which sends the key in <c>X-Admin-Api-Key</c>.
///
/// cv-api has public ingress, so this in-app check — not edge IAM — is the trust
/// boundary. If the key is not configured, every request is rejected: the
/// endpoint fails closed rather than degrading to "open".
/// </summary>
public sealed class AdminApiKeyFilter(IConfiguration configuration) : IAuthorizationFilter
{
    public const string HeaderName = "X-Admin-Api-Key";

    public void OnAuthorization(AuthorizationFilterContext context)
    {
        var configuredKey = configuration["AdminApi:ApiKey"];

        if (string.IsNullOrEmpty(configuredKey)
            || !context.HttpContext.Request.Headers.TryGetValue(HeaderName, out var provided)
            || !FixedTimeEquals(provided.ToString(), configuredKey))
        {
            context.Result = new UnauthorizedResult();
        }
    }

    private static bool FixedTimeEquals(string a, string b)
    {
        // Compare hashes so length differences don't leak and the comparison is
        // constant-time regardless of where the first mismatch is.
        var ha = SHA256.HashData(Encoding.UTF8.GetBytes(a));
        var hb = SHA256.HashData(Encoding.UTF8.GetBytes(b));
        return CryptographicOperations.FixedTimeEquals(ha, hb);
    }
}

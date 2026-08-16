using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using CvApi.Domain.Entities;
using CvApi.Features.Auth.Dtos;
using CvApi.Domain.Repositories;
using Google.Apis.Auth;
using Microsoft.IdentityModel.Tokens;

namespace CvApi.Features.Auth;

public class AuthService(
    IUserRepository users,
    IRefreshTokenRepository refreshTokens,
    IConfiguration config) : IAuthService
{
    private const int RefreshTokenExpiryDays = 30;

    public async Task<AuthResponse?> RegisterAsync(RegisterRequest request)
    {
        if (await users.EmailExistsAsync(request.Email))
            return null;

        var user = new User
        {
            Email = request.Email,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.Password)
        };

        await users.AddAsync(user);

        return new AuthResponse(GenerateToken(user), user.Email);
    }

    public async Task<AuthResponse?> LoginAsync(LoginRequest request)
    {
        var user = await users.GetByEmailAsync(request.Email);
        if (user is null || user.PasswordHash is null || !BCrypt.Net.BCrypt.Verify(request.Password, user.PasswordHash))
            return null;

        return new AuthResponse(GenerateToken(user), user.Email);
    }

    public async Task<AuthResponse?> GoogleLoginAsync(GoogleLoginRequest request)
    {
        var clientId = config["Google:WebClientId"]
            ?? throw new InvalidOperationException("Google:WebClientId is not configured");

        GoogleJsonWebSignature.Payload payload;
        try
        {
            payload = await GoogleJsonWebSignature.ValidateAsync(
                request.Credential,
                new GoogleJsonWebSignature.ValidationSettings { Audience = [clientId] }
            );
        }
        catch
        {
            return null;
        }

        // ValidateAsync already pins the audience to our web client. Still require a
        // Google-verified email before we match/create an account by email address,
        // so an unverified-email identity can't be linked onto someone else's login.
        if (payload.EmailVerified != true || string.IsNullOrEmpty(payload.Email))
            return null;

        return await LinkOrCreateGoogleUserAsync(payload.Subject, payload.Email);
    }

    public async Task<AuthResponse?> GoogleAccessTokenLoginAsync(GoogleAccessTokenRequest request)
    {
        using var http = new HttpClient();
        // Use tokeninfo (not userinfo): it returns the token's `aud` — the OAuth
        // client the access token was minted for. We must reject tokens issued to
        // any *other* Google app, otherwise a token the victim granted to a third
        // party can be replayed here to log in as them (token substitution).
        var infoRes = await http.GetAsync(
            $"https://oauth2.googleapis.com/tokeninfo?access_token={Uri.EscapeDataString(request.AccessToken)}");

        if (!infoRes.IsSuccessStatusCode) return null;

        var info = await infoRes.Content.ReadFromJsonAsync<GoogleTokenInfo>();
        if (!IsTrustedGoogleToken(info, AllowedAccessTokenAudiences()))
            return null;

        return await LinkOrCreateGoogleUserAsync(info!.Sub!, info.Email!);
    }

    /// <summary>
    /// Validates a Google <c>tokeninfo</c> response before it is trusted for login:
    /// the email must be Google-verified, subject and email present, and the token's
    /// audience must be one we issued (the web or extension OAuth client). Pure and
    /// side-effect free so the trust decision is unit-testable without live HTTP.
    /// </summary>
    public static bool IsTrustedGoogleToken(GoogleTokenInfo? info, IReadOnlyCollection<string> allowedAudiences)
    {
        if (info is null) return false;
        if (string.IsNullOrEmpty(info.Sub) || string.IsNullOrEmpty(info.Email)) return false;
        // tokeninfo returns email_verified as the JSON string "true"/"false".
        if (!string.Equals(info.EmailVerified, "true", StringComparison.OrdinalIgnoreCase)) return false;
        if (string.IsNullOrEmpty(info.Aud) || !allowedAudiences.Contains(info.Aud)) return false;
        return true;
    }

    private string[] AllowedAccessTokenAudiences() =>
        new[] { config["Google:WebClientId"], config["Google:ExtensionClientId"] }
            .Where(id => !string.IsNullOrEmpty(id))
            .Select(id => id!)
            .ToArray();

    public sealed record GoogleTokenInfo(
        [property: System.Text.Json.Serialization.JsonPropertyName("sub")] string? Sub,
        [property: System.Text.Json.Serialization.JsonPropertyName("email")] string? Email,
        [property: System.Text.Json.Serialization.JsonPropertyName("email_verified")] string? EmailVerified,
        [property: System.Text.Json.Serialization.JsonPropertyName("aud")] string? Aud);

    public async Task<AuthResponse?> GoogleCodeLoginAsync(GoogleCodeRequest request)
    {
        var clientId = config["Google:WebClientId"]
            ?? throw new InvalidOperationException("Google:WebClientId is not configured");
        var clientSecret = config["Google:ClientSecret"]
            ?? throw new InvalidOperationException("Google:ClientSecret is not configured");

        // Exchange the authorization code for tokens
        using var http = new HttpClient();
        var tokenParams = new Dictionary<string, string>
        {
            ["code"] = request.Code,
            ["client_id"] = clientId,
            ["client_secret"] = clientSecret,
            ["redirect_uri"] = request.RedirectUri,
            ["grant_type"] = "authorization_code",
            ["code_verifier"] = request.CodeVerifier,
        };

        var tokenRes = await http.PostAsync(
            "https://oauth2.googleapis.com/token",
            new FormUrlEncodedContent(tokenParams));

        if (!tokenRes.IsSuccessStatusCode) return null;

        var tokenJson = await tokenRes.Content.ReadFromJsonAsync<GoogleTokenResponse>();
        if (tokenJson?.IdToken is null) return null;

        // Validate the returned ID token
        GoogleJsonWebSignature.Payload payload;
        try
        {
            payload = await GoogleJsonWebSignature.ValidateAsync(
                tokenJson.IdToken,
                new GoogleJsonWebSignature.ValidationSettings { Audience = [clientId] });
        }
        catch
        {
            return null;
        }

        if (payload.EmailVerified != true || string.IsNullOrEmpty(payload.Email))
            return null;

        return await LinkOrCreateGoogleUserAsync(payload.Subject, payload.Email);
    }

    /// <summary>
    /// Finds the user by Google subject, else by (verified) email, else creates one,
    /// backfilling GoogleId on first Google sign-in. Callers must have already
    /// confirmed the email is Google-verified and the token's audience is ours.
    /// </summary>
    private async Task<AuthResponse> LinkOrCreateGoogleUserAsync(string googleId, string email)
    {
        var user = await users.GetByGoogleIdAsync(googleId)
                ?? await users.GetByEmailAsync(email);

        if (user is null)
        {
            user = new User { Email = email, GoogleId = googleId };
            await users.AddAsync(user);
        }
        else if (user.GoogleId is null)
        {
            user.GoogleId = googleId;
            await users.UpdateAsync(user);
        }
        return new AuthResponse(GenerateToken(user), user.Email);
    }

    private sealed record GoogleTokenResponse(
        [property: System.Text.Json.Serialization.JsonPropertyName("id_token")] string? IdToken);

    public async Task<AuthResponse?> RefreshAsync(string refreshToken)
    {
        var tokenHash = HashToken(refreshToken);
        var stored = await refreshTokens.GetByTokenAsync(tokenHash);

        if (stored is null || stored.IsRevoked || stored.ExpiresAt <= DateTime.UtcNow)
            return null;

        // Firestore has no joins, so the owning user — previously an
        // .Include() — is a second read. A token whose user has been deleted
        // is treated as invalid rather than throwing.
        var owner = await users.GetByIdAsync(stored.UserId);
        if (owner is null)
            return null;

        // Rotate: revoke old token, issue new one
        stored.IsRevoked = true;
        await refreshTokens.UpdateAsync(stored);

        return new AuthResponse(GenerateToken(owner), owner.Email);
    }

    public async Task<Guid?> GetUserIdByEmailAsync(string email)
    {
        var user = await users.GetByEmailAsync(email);
        return user?.Id;
    }

    public async Task RevokeRefreshTokenAsync(string refreshToken)
    {
        var tokenHash = HashToken(refreshToken);
        var stored = await refreshTokens.GetByTokenAsync(tokenHash);
        if (stored is not null && !stored.IsRevoked)
        {
            stored.IsRevoked = true;
            await refreshTokens.UpdateAsync(stored);
        }
    }

    /// <summary>
    /// Generates a cryptographically random 64-byte refresh token, persists it hashed
    /// in the database, and returns the raw (unhashed) token to be sent as a cookie.
    /// </summary>
    public async Task<string> IssueRefreshTokenAsync(Guid userId)
    {
        var rawBytes = RandomNumberGenerator.GetBytes(64);
        var rawToken = Convert.ToBase64String(rawBytes);

        await refreshTokens.AddAsync(new RefreshToken
        {
            UserId = userId,
            Token = HashToken(rawToken),
            ExpiresAt = DateTime.UtcNow.AddDays(RefreshTokenExpiryDays),
        });

        return rawToken;
    }

    private static string HashToken(string token)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(token));
        return Convert.ToBase64String(bytes);
    }

    private string GenerateToken(User user)
    {
        var secret = config["JwtSettings:Secret"]
            ?? throw new InvalidOperationException("JWT secret not configured");

        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret));
        var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new Claim(ClaimTypes.Email, user.Email)
        };

        // Defaults must match the validation defaults in Program.cs.
        var token = new JwtSecurityToken(
            issuer: config["JwtSettings:Issuer"] ?? "cv-api",
            audience: config["JwtSettings:Audience"] ?? "cv-app",
            claims: claims,
            expires: DateTime.UtcNow.AddHours(1),
            signingCredentials: credentials
        );

        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}

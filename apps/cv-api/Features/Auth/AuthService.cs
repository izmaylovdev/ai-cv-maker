using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using CvApi.Domain.Entities;
using CvApi.Features.Auth.Dtos;
using CvApi.Infrastructure.Persistence;
using Google.Apis.Auth;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

namespace CvApi.Features.Auth;

public class AuthService(AppDbContext db, IConfiguration config) : IAuthService
{
    private const int RefreshTokenExpiryDays = 30;

    public async Task<AuthResponse?> RegisterAsync(RegisterRequest request)
    {
        if (await db.Users.AnyAsync(u => u.Email == request.Email))
            return null;

        var user = new User
        {
            Email = request.Email,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.Password)
        };

        db.Users.Add(user);
        await db.SaveChangesAsync();

        return new AuthResponse(GenerateToken(user), user.Email);
    }

    public async Task<AuthResponse?> LoginAsync(LoginRequest request)
    {
        var user = await db.Users.FirstOrDefaultAsync(u => u.Email == request.Email);
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

        var user = await db.Users.FirstOrDefaultAsync(u => u.GoogleId == payload.Subject)
                ?? await db.Users.FirstOrDefaultAsync(u => u.Email == payload.Email);

        if (user is null)
        {
            user = new User
            {
                Email = payload.Email,
                GoogleId = payload.Subject
            };
            db.Users.Add(user);
        }
        else if (user.GoogleId is null)
        {
            user.GoogleId = payload.Subject;
        }

        await db.SaveChangesAsync();
        return new AuthResponse(GenerateToken(user), user.Email);
    }

    public async Task<AuthResponse?> GoogleAccessTokenLoginAsync(GoogleAccessTokenRequest request)
    {
        using var http = new HttpClient();
        var infoRes = await http.GetAsync(
            $"https://www.googleapis.com/oauth2/v3/userinfo?access_token={Uri.EscapeDataString(request.AccessToken)}");

        if (!infoRes.IsSuccessStatusCode) return null;

        var info = await infoRes.Content.ReadFromJsonAsync<GoogleUserInfo>();
        if (info?.Email is null || info.Sub is null) return null;

        var user = await db.Users.FirstOrDefaultAsync(u => u.GoogleId == info.Sub)
                ?? await db.Users.FirstOrDefaultAsync(u => u.Email == info.Email);

        if (user is null)
        {
            user = new User { Email = info.Email, GoogleId = info.Sub };
            db.Users.Add(user);
        }
        else if (user.GoogleId is null)
        {
            user.GoogleId = info.Sub;
        }

        await db.SaveChangesAsync();
        return new AuthResponse(GenerateToken(user), user.Email);
    }

    private sealed record GoogleUserInfo(
        [property: System.Text.Json.Serialization.JsonPropertyName("sub")] string? Sub,
        [property: System.Text.Json.Serialization.JsonPropertyName("email")] string? Email);

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

        var user = await db.Users.FirstOrDefaultAsync(u => u.GoogleId == payload.Subject)
                ?? await db.Users.FirstOrDefaultAsync(u => u.Email == payload.Email);

        if (user is null)
        {
            user = new User { Email = payload.Email, GoogleId = payload.Subject };
            db.Users.Add(user);
        }
        else if (user.GoogleId is null)
        {
            user.GoogleId = payload.Subject;
        }

        await db.SaveChangesAsync();
        return new AuthResponse(GenerateToken(user), user.Email);
    }

    private sealed record GoogleTokenResponse(
        [property: System.Text.Json.Serialization.JsonPropertyName("id_token")] string? IdToken);

    public async Task<AuthResponse?> RefreshAsync(string refreshToken)
    {
        var tokenHash = HashToken(refreshToken);
        var stored = await db.RefreshTokens
            .Include(r => r.User)
            .FirstOrDefaultAsync(r => r.Token == tokenHash);

        if (stored is null || stored.IsRevoked || stored.ExpiresAt <= DateTime.UtcNow)
            return null;

        // Rotate: revoke old token, issue new one
        stored.IsRevoked = true;
        await db.SaveChangesAsync();

        return new AuthResponse(GenerateToken(stored.User), stored.User.Email);
    }

    public async Task<Guid?> GetUserIdByEmailAsync(string email)
    {
        var user = await db.Users.AsNoTracking()
            .FirstOrDefaultAsync(u => u.Email == email);
        return user?.Id;
    }

    public async Task RevokeRefreshTokenAsync(string refreshToken)
    {
        var tokenHash = HashToken(refreshToken);
        var stored = await db.RefreshTokens.FirstOrDefaultAsync(r => r.Token == tokenHash);
        if (stored is not null && !stored.IsRevoked)
        {
            stored.IsRevoked = true;
            await db.SaveChangesAsync();
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

        db.RefreshTokens.Add(new RefreshToken
        {
            UserId = userId,
            Token = HashToken(rawToken),
            ExpiresAt = DateTime.UtcNow.AddDays(RefreshTokenExpiryDays),
        });
        await db.SaveChangesAsync();

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

        var token = new JwtSecurityToken(
            claims: claims,
            expires: DateTime.UtcNow.AddHours(1),
            signingCredentials: credentials
        );

        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}

using CvApi.Features.Auth;

namespace CvApi.Tests;

// Unit tests for the pure token-trust decision behind POST /api/auth/google/token.
// A Google access token must be issued to *our* OAuth client (audience allowlist)
// and carry a Google-verified email before it is trusted for login — otherwise a
// token the victim granted to any third-party Google app could be replayed to log
// in as them (token substitution). See ADR-0017.
public class GoogleTokenTrustTests
{
    private static readonly string[] Allowed =
    {
        "web-client.apps.googleusercontent.com",
        "ext-client.apps.googleusercontent.com",
    };

    private static AuthService.GoogleTokenInfo Info(
        string? sub = "google-sub-123",
        string? email = "user@example.com",
        string? emailVerified = "true",
        string? aud = "web-client.apps.googleusercontent.com")
        => new(sub, email, emailVerified, aud);

    [Fact]
    public void TrustedWhenAudienceAllowedAndEmailVerified()
        => Assert.True(AuthService.IsTrustedGoogleToken(Info(), Allowed));

    [Fact]
    public void TrustedForExtensionAudience()
        => Assert.True(AuthService.IsTrustedGoogleToken(
            Info(aud: "ext-client.apps.googleusercontent.com"), Allowed));

    [Fact]
    public void RejectedWhenAudienceNotOurs()
        => Assert.False(AuthService.IsTrustedGoogleToken(
            Info(aud: "attacker-app.apps.googleusercontent.com"), Allowed));

    [Fact]
    public void RejectedWhenAudienceMissing()
        => Assert.False(AuthService.IsTrustedGoogleToken(Info(aud: null), Allowed));

    [Fact]
    public void RejectedWhenEmailNotVerified()
        => Assert.False(AuthService.IsTrustedGoogleToken(Info(emailVerified: "false"), Allowed));

    [Fact]
    public void RejectedWhenEmailVerifiedMissing()
        => Assert.False(AuthService.IsTrustedGoogleToken(Info(emailVerified: null), Allowed));

    [Fact]
    public void RejectedWhenEmailMissing()
        => Assert.False(AuthService.IsTrustedGoogleToken(Info(email: null), Allowed));

    [Fact]
    public void RejectedWhenSubjectMissing()
        => Assert.False(AuthService.IsTrustedGoogleToken(Info(sub: null), Allowed));

    [Fact]
    public void RejectedWhenInfoNull()
        => Assert.False(AuthService.IsTrustedGoogleToken(null, Allowed));

    [Fact]
    public void RejectedWhenAllowListEmpty()
        => Assert.False(AuthService.IsTrustedGoogleToken(Info(), System.Array.Empty<string>()));
}

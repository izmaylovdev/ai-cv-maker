using CvApi.Features.Auth.Dtos;
using Microsoft.AspNetCore.Mvc;

namespace CvApi.Features.Auth;

[ApiController]
[Route("api/auth")]
public class AuthController(IAuthService authService) : ControllerBase
{
    private const string RefreshTokenCookie = "refresh_token";
    private const int RefreshTokenExpiryDays = 30;

    [HttpPost("register")]
    public async Task<ActionResult<AuthResponse>> Register(RegisterRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Email) || string.IsNullOrWhiteSpace(request.Password))
            return BadRequest("Email and password are required.");

        var result = await authService.RegisterAsync(request);
        if (result is null)
            return Conflict("A user with this email already exists.");

        await SetRefreshTokenCookieForEmailAsync(result.Email);
        return Ok(result);
    }

    [HttpPost("login")]
    public async Task<ActionResult<AuthResponse>> Login(LoginRequest request)
    {
        var result = await authService.LoginAsync(request);
        if (result is null)
            return Unauthorized("Invalid email or password.");

        await SetRefreshTokenCookieForEmailAsync(result.Email);
        return Ok(result);
    }

    [HttpPost("google")]
    public async Task<ActionResult<AuthResponse>> GoogleLogin(GoogleLoginRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Credential))
            return BadRequest("Google credential is required.");

        var result = await authService.GoogleLoginAsync(request);
        if (result is null)
            return Unauthorized("Invalid Google credential.");

        await SetRefreshTokenCookieForEmailAsync(result.Email);
        return Ok(result);
    }

    [HttpPost("google/token")]
    public async Task<ActionResult<AuthResponse>> GoogleAccessTokenLogin(GoogleAccessTokenRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.AccessToken))
            return BadRequest("Access token is required.");

        var result = await authService.GoogleAccessTokenLoginAsync(request);
        if (result is null)
            return Unauthorized("Invalid Google access token.");

        await SetRefreshTokenCookieForEmailAsync(result.Email);
        return Ok(result);
    }

    [HttpPost("google/code")]
    public async Task<ActionResult<AuthResponse>> GoogleCodeLogin(GoogleCodeRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Code))
            return BadRequest("Authorization code is required.");

        var result = await authService.GoogleCodeLoginAsync(request);
        if (result is null)
            return Unauthorized("Invalid Google authorization code.");

        await SetRefreshTokenCookieForEmailAsync(result.Email);
        return Ok(result);
    }

    [HttpPost("refresh")]
    public async Task<ActionResult<AuthResponse>> Refresh()
    {
        var existingToken = Request.Cookies[RefreshTokenCookie];
        if (string.IsNullOrWhiteSpace(existingToken))
            return Unauthorized("No refresh token.");

        var result = await authService.RefreshAsync(existingToken);
        if (result is null)
        {
            DeleteRefreshTokenCookie();
            return Unauthorized("Refresh token is invalid or expired.");
        }

        // Issue a new refresh token (rotation)
        await SetRefreshTokenCookieForEmailAsync(result.Email);
        return Ok(result);
    }

    [HttpPost("logout")]
    public async Task<IActionResult> Logout()
    {
        var token = Request.Cookies[RefreshTokenCookie];
        if (!string.IsNullOrWhiteSpace(token))
            await authService.RevokeRefreshTokenAsync(token);

        DeleteRefreshTokenCookie();
        return NoContent();
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    /// <summary>
    /// Looks up the user by email, issues a new refresh token, and sets the HttpOnly cookie.
    /// Called after every successful authentication flow.
    /// </summary>
    private async Task SetRefreshTokenCookieForEmailAsync(string email)
    {
        // We need the user ID to store the refresh token; fetch it from DB via AuthService
        // by re-using the interface. To avoid coupling, we pass the email back to a helper.
        // In practice the user was just created/found in the same request — this is a second
        // lightweight query but keeps the controller thin.
        var userId = await authService.GetUserIdByEmailAsync(email);
        if (userId is null) return;

        var rawToken = await authService.IssueRefreshTokenAsync(userId.Value);
        Response.Cookies.Append(RefreshTokenCookie, rawToken, new CookieOptions
        {
            HttpOnly = true,
            Secure = true,
            SameSite = SameSiteMode.Strict,
            Expires = DateTimeOffset.UtcNow.AddDays(RefreshTokenExpiryDays),
            Path = "/api/auth",
        });
    }

    private void DeleteRefreshTokenCookie() =>
        Response.Cookies.Delete(RefreshTokenCookie, new CookieOptions
        {
            HttpOnly = true,
            Secure = true,
            SameSite = SameSiteMode.Strict,
            Path = "/api/auth",
        });
}

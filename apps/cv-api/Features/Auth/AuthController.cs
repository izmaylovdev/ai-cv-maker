using CvApi.Features.Auth.Dtos;
using Microsoft.AspNetCore.Mvc;

namespace CvApi.Features.Auth;

[ApiController]
[Route("api/auth")]
public class AuthController(IAuthService authService) : ControllerBase
{
    [HttpPost("register")]
    public async Task<ActionResult<AuthResponse>> Register(RegisterRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Email) || string.IsNullOrWhiteSpace(request.Password))
            return BadRequest("Email and password are required.");

        var result = await authService.RegisterAsync(request);
        if (result is null)
            return Conflict("A user with this email already exists.");

        return Ok(result);
    }

    [HttpPost("login")]
    public async Task<ActionResult<AuthResponse>> Login(LoginRequest request)
    {
        var result = await authService.LoginAsync(request);
        if (result is null)
            return Unauthorized("Invalid email or password.");

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

        return Ok(result);
    }
}

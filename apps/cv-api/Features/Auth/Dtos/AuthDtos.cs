namespace CvApi.Features.Auth.Dtos;

public record RegisterRequest(string Email, string Password);
public record LoginRequest(string Email, string Password);
public record GoogleLoginRequest(string Credential);
public record GoogleCodeRequest(string Code, string CodeVerifier, string RedirectUri);
public record GoogleAccessTokenRequest(string AccessToken);
public record AuthResponse(string Token, string Email);

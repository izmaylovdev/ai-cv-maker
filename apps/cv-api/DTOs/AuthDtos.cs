namespace CvApi.DTOs;

public record RegisterRequest(string Email, string Password);
public record LoginRequest(string Email, string Password);
public record GoogleLoginRequest(string Credential);
public record AuthResponse(string Token, string Email);

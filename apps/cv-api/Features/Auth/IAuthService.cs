using CvApi.Features.Auth.Dtos;

namespace CvApi.Features.Auth;

public interface IAuthService
{
    Task<AuthResponse?> RegisterAsync(RegisterRequest request);
    Task<AuthResponse?> LoginAsync(LoginRequest request);
    Task<AuthResponse?> GoogleLoginAsync(GoogleLoginRequest request);
}

using CvApi.Features.Auth.Dtos;

namespace CvApi.Features.Auth;

public interface IAuthService
{
    Task<AuthResponse?> RegisterAsync(RegisterRequest request);
    Task<AuthResponse?> LoginAsync(LoginRequest request);
    Task<AuthResponse?> GoogleLoginAsync(GoogleLoginRequest request);
    Task<AuthResponse?> GoogleCodeLoginAsync(GoogleCodeRequest request);
    Task<AuthResponse?> GoogleAccessTokenLoginAsync(GoogleAccessTokenRequest request);
    Task<AuthResponse?> RefreshAsync(string refreshToken);
    Task<string> IssueRefreshTokenAsync(Guid userId);
    Task RevokeRefreshTokenAsync(string refreshToken);
    Task<Guid?> GetUserIdByEmailAsync(string email);
}

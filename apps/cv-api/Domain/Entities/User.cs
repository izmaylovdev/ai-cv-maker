namespace CvApi.Domain.Entities;

public class User
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Email { get; set; } = string.Empty;
    public string? PasswordHash { get; set; }
    public string? GoogleId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public List<Profile> Profiles { get; set; } = [];
}

namespace CvApi.Domain.Entities;

public class Profile
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    /// <summary>The profile's label in the job-profiles list (not the CV's full name).</summary>
    public string Name { get; set; } = "My Profile";

    /// <summary>Canonical profile content (ADR-0013), stored as jsonb.</summary>
    public ProfileDocument Document { get; set; } = ProfileDocument.Empty();

    public User User { get; set; } = null!;
    public List<GeneratedCv> GeneratedCvs { get; set; } = [];
}

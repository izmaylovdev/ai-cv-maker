namespace CvApi.Models;

public class Profile
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public string Name { get; set; } = "My Profile";
    public string FullName { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Overview { get; set; } = string.Empty;
    public string? Location { get; set; }
    public string? ContactEmail { get; set; }
    public string? ContactPhone { get; set; }

    public User User { get; set; } = null!;
    public List<WorkExperience> WorkExperiences { get; set; } = [];
    public List<Education> Educations { get; set; } = [];
    public List<Skill> Skills { get; set; } = [];
    public string SectionOrder { get; set; } = "workExperiences,educations,skills";
    public List<GeneratedCv> GeneratedCvs { get; set; } = [];
}

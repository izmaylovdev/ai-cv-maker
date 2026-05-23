namespace CvApi.Domain.Entities;

public class WorkExperience
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ProfileId { get; set; }
    public string Company { get; set; } = string.Empty;
    public string Role { get; set; } = string.Empty;
    public DateOnly StartDate { get; set; }
    public DateOnly? EndDate { get; set; }
    public string Description { get; set; } = string.Empty;

    public Profile Profile { get; set; } = null!;
}

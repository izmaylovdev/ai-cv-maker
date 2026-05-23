namespace CvApi.Domain.Entities;

public class Education
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ProfileId { get; set; }
    public string Institution { get; set; } = string.Empty;
    public string Degree { get; set; } = string.Empty;
    public string Field { get; set; } = string.Empty;
    public int StartYear { get; set; }
    public int? EndYear { get; set; }

    public Profile Profile { get; set; } = null!;
}

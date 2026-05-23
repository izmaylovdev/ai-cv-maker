namespace CvApi.Domain.Entities;

public class GeneratedCv
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ProfileId { get; set; }
    public Profile Profile { get; set; } = null!;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public string? OptimizationNotes { get; set; }
    public string FullName { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string? Location { get; set; }
    public string? ContactEmail { get; set; }
    public string? ContactPhone { get; set; }
    public string CvDataJson { get; set; } = "{}";
}

namespace CvApi.Domain.Entities;

public class Skill
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ProfileId { get; set; }
    public string Name { get; set; } = string.Empty;
    public int Order { get; set; }

    public Profile Profile { get; set; } = null!;
}

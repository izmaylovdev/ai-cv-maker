namespace CvApi.Domain.Entities;

/// <summary>
/// Generic single-value app configuration stored in the database so it can be
/// changed at runtime (e.g. from the admin panel) without a redeploy. The
/// <see cref="Key"/> is the primary key; <see cref="Value"/> is the serialized
/// value. Absence of a row means "fall back to the appsettings.json default".
/// </summary>
public class AppSetting
{
    public string Key { get; set; } = string.Empty;
    public string Value { get; set; } = string.Empty;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

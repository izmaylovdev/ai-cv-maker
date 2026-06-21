using System.Text.Json;
using System.Text.Json.Serialization;

namespace CvApi.Infrastructure.Persistence;

// Serialization settings for the Profile.Document jsonb column (ADR-0013).
// camelCase + omit-nulls so the stored JSON matches the builder's wire payload
// (apps/profile-builder-ui ProfileDocument).
public static class ProfileDocumentJson
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };
}

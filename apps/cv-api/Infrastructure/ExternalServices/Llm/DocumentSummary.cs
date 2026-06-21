using CvApi.Domain.Entities;

namespace CvApi.Infrastructure.ExternalServices.Llm;

// Small, lossy summariser of a ProfileDocument into the lightweight
// ProfileSummary shape (name/title/overview/skills) the user-chat agent reads.
// Unlike the retired LegacyDocumentProjection this never reconstructs the old
// structured model — it just reads a few header/section signals.
public static class DocumentSummary
{
    private static readonly string[] SummaryHeadings =
        ["summary", "overview", "about", "profile", "objective"];

    public static LlmProfileSummary Summarise(string name, ProfileDocument doc)
    {
        var overview = Overview(doc);
        var skills = doc.Sections
            .Where(s => s.Template == "list")
            .SelectMany(s => s.Items ?? [])
            .Select(i => (i.Text ?? string.Empty).Trim())
            .Where(t => t.Length > 0)
            .ToList();

        return new LlmProfileSummary(name, doc.Header.Title, overview, skills);
    }

    /// <summary>Best-effort overview from the first summary-like free-form section.</summary>
    private static string Overview(ProfileDocument doc)
    {
        var freeForm = doc.Sections.Where(s => s.Template == "free-form").ToList();
        var summary = freeForm.FirstOrDefault(s =>
            SummaryHeadings.Any(h => s.Heading.Contains(h, StringComparison.OrdinalIgnoreCase)));
        return (summary ?? freeForm.FirstOrDefault())?.Body?.Trim() ?? string.Empty;
    }
}

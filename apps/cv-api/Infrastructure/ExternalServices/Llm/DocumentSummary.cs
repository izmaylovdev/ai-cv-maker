using CvApi.Domain.Entities;

namespace CvApi.Infrastructure.ExternalServices.Llm;

// Small, lossy summariser of a ProfileDocument into the lightweight
// ProfileSummary shape (name/title/overview/skills) the user-chat agent reads.
// Walks the BlockNode body (ADR-0014): overview comes from the first
// summary-like section's paragraph text; skills come from chips/list leaves.
public static class DocumentSummary
{
    private static readonly string[] SummaryHeadings =
        ["summary", "overview", "about", "profile", "objective"];

    public static LlmProfileSummary Summarise(string name, ProfileDocument doc)
    {
        var sections = doc.Body.Children.Where(n => n.Type == "section").ToList();
        var overview = Overview(sections);
        var skills = sections
            .SelectMany(SkillLeaves)
            .Select(t => t.Trim())
            .Where(t => t.Length > 0)
            .ToList();

        return new LlmProfileSummary(name, doc.Header.Title, overview, skills);
    }

    /// <summary>Best-effort overview from the first summary-like section's text.</summary>
    private static string Overview(List<BlockNode> sections)
    {
        var summary = sections.FirstOrDefault(s =>
            SummaryHeadings.Any(h => Heading(s).Contains(h, StringComparison.OrdinalIgnoreCase)));
        var chosen = summary ?? sections.FirstOrDefault();
        return chosen is null ? string.Empty : ParagraphText(chosen).Trim();
    }

    private static string Heading(BlockNode section) =>
        section.Attrs.TryGetValue("heading", out var h) ? h : string.Empty;

    // Concatenated text of the section's top-level paragraphs.
    private static string ParagraphText(BlockNode section)
    {
        var parts = section.Children
            .Where(c => c.Type == "paragraph")
            .Select(p => string.Concat(p.Children
                .Where(t => t.Type == "text")
                .Select(t => t.Attrs.GetValueOrDefault("text", string.Empty))));
        return string.Join("\n", parts.Where(p => p.Length > 0));
    }

    // Text of every chip (and list-item paragraph) anywhere in the section.
    private static IEnumerable<string> SkillLeaves(BlockNode section)
    {
        foreach (var node in Descendants(section))
        {
            if (node.Type == "chip")
                yield return node.Attrs.GetValueOrDefault("text", string.Empty);
        }
    }

    private static IEnumerable<BlockNode> Descendants(BlockNode node)
    {
        foreach (var child in node.Children)
        {
            yield return child;
            foreach (var d in Descendants(child))
                yield return d;
        }
    }
}

using CvApi.Domain.Entities;

namespace CvApi.Infrastructure.ExternalServices.Llm;

// Small, lossy summariser of a ProfileDocument into the lightweight
// ProfileSummary shape (name/title/overview/skills) the user-chat agent reads.
// Walks the BlockNode body (ADR-0014 / US-EDIT-19): body is now a flat list of
// `title` heading nodes and flow nodes. A virtual section = a `title` node plus
// all following flow nodes until the next `title`. Overview comes from the first
// summary-like section's paragraph text; skills are chips anywhere in the body.
public static class DocumentSummary
{
    private static readonly string[] SummaryHeadings =
        ["summary", "overview", "about", "profile", "objective"];

    public static LlmProfileSummary Summarise(string name, ProfileDocument doc)
    {
        var sections = GroupBySections(doc.Body.Children);
        var overview = FindOverview(sections);
        var skills = Descendants(doc.Body)
            .Where(n => n.Type == "chip")
            .Select(n => n.Attrs.GetValueOrDefault("text", string.Empty).Trim())
            .Where(t => t.Length > 0)
            .ToList();

        return new LlmProfileSummary(name, doc.Header.Title, overview, skills);
    }

    // Groups a flat root children list into virtual sections by `title` nodes.
    private record Section(string? Heading, List<BlockNode> Nodes);

    private static List<Section> GroupBySections(List<BlockNode> bodyChildren)
    {
        var result = new List<Section>();
        string? currentHeading = null;
        var currentNodes = new List<BlockNode>();

        foreach (var node in bodyChildren)
        {
            if (node.Type == "title")
            {
                if (currentNodes.Count > 0 || currentHeading != null)
                    result.Add(new Section(currentHeading, currentNodes));
                currentHeading = node.Attrs.GetValueOrDefault("text", string.Empty);
                currentNodes = [];
            }
            else
            {
                currentNodes.Add(node);
            }
        }

        if (currentNodes.Count > 0 || currentHeading != null)
            result.Add(new Section(currentHeading, currentNodes));

        return result;
    }

    /// <summary>Best-effort overview from the first summary-like section's text.</summary>
    private static string FindOverview(List<Section> sections)
    {
        var summary = sections.FirstOrDefault(s =>
            s.Heading != null &&
            SummaryHeadings.Any(h => s.Heading.Contains(h, StringComparison.OrdinalIgnoreCase)));
        var chosen = summary ?? sections.FirstOrDefault();
        return chosen is null ? string.Empty : ParagraphText(chosen.Nodes).Trim();
    }

    // Concatenated text of paragraph nodes in a list.
    private static string ParagraphText(List<BlockNode> nodes)
    {
        var parts = nodes
            .Where(c => c.Type == "paragraph")
            .Select(p => string.Concat(p.Children
                .Where(t => t.Type == "text")
                .Select(t => t.Attrs.GetValueOrDefault("text", string.Empty))));
        return string.Join("\n", parts.Where(p => p.Length > 0));
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

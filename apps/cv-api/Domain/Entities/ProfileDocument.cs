namespace CvApi.Domain.Entities;

// Canonical profile model (ADR-0014, amends ADR-0013): a fixed identity/contact
// header plus a `body` which is a recursive BlockNode tree. This mirrors the
// TypeScript `BlockNode`/`ProfileDocument` in apps/profile-builder-ui/src/model.ts
// — that file is the reference definition; the JSON shapes must stay in sync.
// Stored as a single jsonb column on Profile.
public class ProfileDocument
{
    public ProfileHeader Header { get; set; } = new();

    /// <summary>Root of the block tree (always a node of type "root").</summary>
    public BlockNode Body { get; set; } = BlockNode.Root();

    public static ProfileDocument Empty() => new();

    /// <summary>
    /// Default CV starter template (US-PROF-6): an empty header plus a body of four
    /// titled sections — Professional Summary, Work Experience, Education, Skills —
    /// each with empty scaffolding (a blank paragraph, timelines with one empty entry,
    /// an empty skills chips group). Carries structure only: no fake identity or
    /// content data. The tree is schema-valid (see ProfileDocumentSchema); empty
    /// nodes render as editable scaffolding in the editor and are skipped by the PDF
    /// walk, so an untouched new profile still produces a near-empty PDF by design.
    /// </summary>
    public static ProfileDocument DefaultTemplate()
    {
        static BlockNode Node(string type, Dictionary<string, string>? attrs = null, List<BlockNode>? children = null)
            => new()
            {
                Type = type,
                Id = Guid.NewGuid().ToString("n"),
                Attrs = attrs ?? [],
                Children = children ?? [],
            };

        static BlockNode Title(string text) => Node("title", new() { ["text"] = text });

        // A timeline pre-seeded with a single blank entry the user fills in.
        static BlockNode EmptyTimeline() => Node("timeline", children:
        [
            Node("entry", new() { ["title"] = string.Empty, ["dates"] = string.Empty }, children:
            [
                Node("paragraph"),
            ]),
        ]);

        var body = BlockNode.Root();
        body.Children =
        [
            Title("Professional Summary"),
            Node("paragraph"),
            Title("Work Experience"),
            EmptyTimeline(),
            Title("Education"),
            EmptyTimeline(),
            Title("Skills"),
            Node("chips"),
        ];

        return new ProfileDocument { Body = body };
    }
}

public class ProfileHeader
{
    public string FullName { get; set; } = string.Empty;
    /// <summary>Professional headline / job title.</summary>
    public string Title { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public string Phone { get; set; } = string.Empty;
    public string Location { get; set; } = string.Empty;
}

// One node of the block tree (ADR-0014 §9.2 / US-EDIT-19). `Type` is from the closed set
// (root, title, paragraph, text, link, list, listItem, chips, chip, timeline, entry).
// `Attrs` carries type-specific leaf data (e.g. text→{text}, title→{text},
// entry→{title,dates}). `Children` is ordered; array order IS document order.
public class BlockNode
{
    public string Type { get; set; } = string.Empty;
    public string Id { get; set; } = string.Empty;
    public Dictionary<string, string> Attrs { get; set; } = [];
    public List<BlockNode> Children { get; set; } = [];

    public static BlockNode Root() => new() { Type = "root", Id = Guid.NewGuid().ToString("n") };
}

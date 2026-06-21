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

// One node of the block tree (ADR-0014 §9.2). `Type` is from the closed set
// (root, section, paragraph, text, list, listItem, chips, chip, timeline, entry).
// `Attrs` carries type-specific leaf data (e.g. text→{text}, section→{heading},
// entry→{title,dates}). `Children` is ordered; array order IS document order.
public class BlockNode
{
    public string Type { get; set; } = string.Empty;
    public string Id { get; set; } = string.Empty;
    public Dictionary<string, string> Attrs { get; set; } = [];
    public List<BlockNode> Children { get; set; } = [];

    public static BlockNode Root() => new() { Type = "root", Id = Guid.NewGuid().ToString("n") };
}

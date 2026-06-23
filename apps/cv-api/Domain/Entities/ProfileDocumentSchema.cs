namespace CvApi.Domain.Entities;

// Schema validator for the BlockNode tree (ADR-0014 §9.3 / §13). Enforces the
// closed type set, the allowed-children matrix, and a bounded nesting depth.
// cv-api rejects violating trees on write (400); the editor cannot author them
// and the PDF walk may assume a valid tree. Mirrors the TS schema in
// apps/profile-builder-ui (the reference). Updated for US-EDIT-19: 'section'
// is retired; 'title' is the new flat heading node at root level.
public static class ProfileDocumentSchema
{
    /// <summary>Max flow nesting depth (§9.3, default 4).</summary>
    public const int MaxFlowDepth = 4;

    // Allowed child types per node type. An empty set means "leaf" (no children).
    private static readonly Dictionary<string, HashSet<string>> AllowedChildren = new()
    {
        ["root"]     = ["title", "paragraph", "list", "chips", "timeline", "link"],
        ["title"]    = [],
        ["paragraph"] = ["text"],
        ["text"]     = [],
        ["link"]     = [],
        ["list"]     = ["listItem"],
        ["listItem"] = ["paragraph", "list", "chips", "link"],
        ["chips"]    = ["chip"],
        ["chip"]     = [],
        ["timeline"] = ["entry"],
        ["entry"]    = ["paragraph", "list", "link"],
    };

    // Only list/timeline introduce a new flow nesting level — mirrors the TS
    // FLOW_CONTAINERS set so the depth check is identical on both sides.
    private static readonly HashSet<string> FlowContainers = ["list", "timeline"];

    public static bool IsKnownType(string type) => AllowedChildren.ContainsKey(type);

    /// <summary>
    /// Converts any legacy <c>section</c> nodes (ADR-0013) in the body's direct
    /// children into a flat <c>title</c> node followed by the section's former
    /// children — mirroring the F-EDIT-19.8 migration in the TS serializer so that
    /// the first PUT after an old document is opened upgrades the stored tree.
    /// Returns the same instance when no migration is needed (fast path).
    /// </summary>
    public static ProfileDocument MigrateLegacySections(ProfileDocument doc)
    {
        var body = doc.Body;
        if (body.Children.TrueForAll(c => c.Type != "section"))
            return doc;

        var migrated = new List<BlockNode>();
        foreach (var child in body.Children)
        {
            if (child.Type != "section")
            {
                migrated.Add(child);
                continue;
            }
            // section → title carrying the heading text, then its former children flat.
            var heading = child.Attrs.GetValueOrDefault("heading", string.Empty);
            migrated.Add(new BlockNode
            {
                Type = "title",
                Id = child.Id,
                Attrs = new Dictionary<string, string> { ["text"] = heading },
            });
            migrated.AddRange(child.Children);
        }

        return new ProfileDocument
        {
            Header = doc.Header,
            Body = new BlockNode
            {
                Type = body.Type,
                Id = body.Id,
                Attrs = body.Attrs,
                Children = migrated,
            },
        };
    }

    /// <summary>
    /// Validates the body tree. Returns null when valid, otherwise a human-readable
    /// reason for the first violation found.
    /// </summary>
    public static string? Validate(BlockNode? body)
    {
        if (body is null)
            return "body is required";
        if (body.Type != "root")
            return $"body root must be type 'root', got '{body.Type}'";
        return ValidateNode(body, depth: 0);
    }

    private static string? ValidateNode(BlockNode node, int depth)
    {
        if (!AllowedChildren.TryGetValue(node.Type, out var allowed))
            return $"unknown node type '{node.Type}'";

        // Depth counts only flow-container levels (list/timeline), matching the
        // TS validateDocument logic. Non-container nodes (paragraph, entry, etc.)
        // do not increment depth, so a list-inside-timeline-entry stays at depth 2.
        var nextDepth = FlowContainers.Contains(node.Type) ? depth + 1 : depth;
        if (nextDepth > MaxFlowDepth)
            return $"node tree exceeds max depth ({MaxFlowDepth} flow levels)";

        foreach (var child in node.Children)
        {
            if (!allowed.Contains(child.Type))
                return $"'{child.Type}' is not allowed inside '{node.Type}'";

            var childError = ValidateNode(child, nextDepth);
            if (childError is not null)
                return childError;
        }

        return null;
    }
}

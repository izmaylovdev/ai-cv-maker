namespace CvApi.Domain.Entities;

// Schema validator for the BlockNode tree (ADR-0014 §9.3 / §13). Enforces the
// closed type set, the allowed-children matrix, and a bounded nesting depth.
// cv-api rejects violating trees on write (400); the editor cannot author them
// and the PDF walk may assume a valid tree. Mirrors the TS schema in
// apps/profile-builder-ui (the reference). Updated for US-EDIT-19: 'section'
// is retired; 'title' is the new flat heading node at root level. The standalone
// 'link' block is retired too: links are 'inlineLink' runs inside paragraphs.
public static class ProfileDocumentSchema
{
    /// <summary>Max flow nesting depth (§9.3, default 4).</summary>
    public const int MaxFlowDepth = 4;

    // Allowed child types per node type. An empty set means "leaf" (no children).
    private static readonly Dictionary<string, HashSet<string>> AllowedChildren = new()
    {
        ["root"]     = ["title", "paragraph", "list", "chips", "timeline"],
        ["title"]    = [],
        ["paragraph"] = ["text", "inlineLink"],
        ["text"]     = [],
        ["inlineLink"] = [],
        ["list"]     = ["listItem"],
        ["listItem"] = ["paragraph", "list", "chips"],
        ["chips"]    = ["chip"],
        ["chip"]     = [],
        ["timeline"] = ["entry"],
        ["entry"]    = ["paragraph", "list", "chips"],
    };

    // Only list/timeline introduce a new flow nesting level — mirrors the TS
    // FLOW_CONTAINERS set so the depth check is identical on both sides.
    private static readonly HashSet<string> FlowContainers = ["list", "timeline"];

    public static bool IsKnownType(string type) => AllowedChildren.ContainsKey(type);

    /// <summary>
    /// Upgrades a stored or LLM-produced document to the current schema, mirroring
    /// the migrations in the TS serializer so that the first PUT after an old
    /// document is opened upgrades the stored tree:
    /// <list type="bullet">
    /// <item>legacy <c>section</c> nodes (ADR-0013) in the body's direct children
    /// become a flat <c>title</c> followed by the section's former children;</item>
    /// <item>legacy standalone <c>link</c> blocks anywhere in the tree become a
    /// <c>paragraph</c> (keeping the link's id) holding one <c>inlineLink</c> run.</item>
    /// </list>
    /// Returns the same instance when no migration is needed (fast path).
    /// </summary>
    public static ProfileDocument MigrateLegacy(ProfileDocument doc)
    {
        var migrated = MigrateLegacySections(doc);
        var body = MigrateLegacyLinks(migrated.Body);
        if (ReferenceEquals(body, migrated.Body))
            return migrated;
        return new ProfileDocument { Header = migrated.Header, Body = body };
    }

    private static ProfileDocument MigrateLegacySections(ProfileDocument doc)
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

    // Rewrites `link` blocks in the subtree. Returns the same node instance when the
    // subtree holds no `link`, so untouched documents are not copied.
    private static BlockNode MigrateLegacyLinks(BlockNode node)
    {
        List<BlockNode>? children = null;
        for (var i = 0; i < node.Children.Count; i++)
        {
            var child = node.Children[i];
            var replacement = child.Type == "link" ? LinkToParagraph(child) : MigrateLegacyLinks(child);
            if (children is null && ReferenceEquals(replacement, child))
                continue;
            children ??= node.Children.Take(i).ToList();
            if (replacement is not null)
                children.Add(replacement);
        }

        if (children is null)
            return node;
        return new BlockNode { Type = node.Type, Id = node.Id, Attrs = node.Attrs, Children = children };
    }

    // link → paragraph (keeps the link's id) > inlineLink { text (url when empty), url }.
    // No url → a paragraph of plain text; neither text nor url → dropped (null).
    private static BlockNode? LinkToParagraph(BlockNode link)
    {
        var text = link.Attrs.GetValueOrDefault("text", string.Empty);
        var url = link.Attrs.GetValueOrDefault("url", string.Empty);
        if (string.IsNullOrEmpty(text) && string.IsNullOrEmpty(url))
            return null;

        var run = string.IsNullOrEmpty(url)
            ? new BlockNode
            {
                Type = "text",
                Id = Guid.NewGuid().ToString("n"),
                Attrs = new Dictionary<string, string> { ["text"] = text },
            }
            : new BlockNode
            {
                Type = "inlineLink",
                Id = Guid.NewGuid().ToString("n"),
                Attrs = new Dictionary<string, string>
                {
                    ["text"] = string.IsNullOrEmpty(text) ? url : text,
                    ["url"] = url,
                },
            };

        return new BlockNode { Type = "paragraph", Id = link.Id, Children = [run] };
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

namespace CvApi.Domain.Entities;

// Schema validator for the BlockNode tree (ADR-0014 §9.3). Enforces the closed
// type set, the allowed-children matrix, and a bounded nesting depth. cv-api
// rejects violating trees on write (400); the editor cannot author them and the
// PDF walk may assume a valid tree. Mirrors the TS schema in
// apps/profile-builder-ui (the reference).
public static class ProfileDocumentSchema
{
    /// <summary>Max flow nesting depth below a section (§9.3, default 4).</summary>
    public const int MaxFlowDepth = 4;

    // Allowed child types per node type. An empty set means "leaf" (no children).
    private static readonly Dictionary<string, HashSet<string>> AllowedChildren = new()
    {
        ["root"] = ["section"],
        ["section"] = ["paragraph", "list", "chips", "timeline"],
        ["paragraph"] = ["text"],
        ["text"] = [],
        ["list"] = ["listItem"],
        ["listItem"] = ["paragraph", "list", "chips"],
        ["chips"] = ["chip"],
        ["chip"] = [],
        ["timeline"] = ["entry"],
        ["entry"] = ["paragraph", "list"],
    };

    public static bool IsKnownType(string type) => AllowedChildren.ContainsKey(type);

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

        // Depth is measured in flow levels below the section. root(0)/section(1)
        // are structural; paragraph/list/etc. count toward the flow-depth bound.
        if (depth > MaxFlowDepth + 1)
            return $"node tree exceeds max depth ({MaxFlowDepth} flow levels)";

        foreach (var child in node.Children)
        {
            if (!allowed.Contains(child.Type))
                return $"'{child.Type}' is not allowed inside '{node.Type}'";

            var childError = ValidateNode(child, depth + 1);
            if (childError is not null)
                return childError;
        }

        return null;
    }
}

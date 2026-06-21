namespace CvApi.Domain.Entities;

// Canonical profile model (ADR-0013): a document of freely added/removed/reordered
// sections plus a fixed identity/contact header. This mirrors the TypeScript
// `ProfileDocument` in apps/profile-builder-ui/src/model.ts — that file is the
// reference definition; the JSON shapes must stay in sync. Stored as a single
// jsonb column on Profile.
public class ProfileDocument
{
    public ProfileHeader Header { get; set; } = new();
    public List<DocumentSection> Sections { get; set; } = [];

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

// One generic section. `Template` discriminates the content: "free-form" uses
// `Body`; "timeline" and "list" use `Items` (a union — timeline items carry
// Title/Dates/Description, list items carry Text). Modelled as a single flexible
// type so the jsonb round-trips the builder's payload without polymorphic
// metadata.
public class DocumentSection
{
    public string Id { get; set; } = string.Empty;
    /// <summary>"free-form" | "timeline" | "list".</summary>
    public string Template { get; set; } = "free-form";
    public string Heading { get; set; } = string.Empty;

    /// <summary>Free-form body (template = "free-form").</summary>
    public string? Body { get; set; }

    /// <summary>Entries (template = "timeline" or "list").</summary>
    public List<SectionItem>? Items { get; set; }
}

public class SectionItem
{
    public string Id { get; set; } = string.Empty;

    // Timeline item.
    public string? Title { get; set; }
    /// <summary>Free-text date range, e.g. "Jan 2022 – Present".</summary>
    public string? Dates { get; set; }
    public string? Description { get; set; }

    // List item.
    public string? Text { get; set; }
}

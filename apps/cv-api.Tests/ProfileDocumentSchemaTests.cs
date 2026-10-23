using CvApi.Domain.Entities;
using Xunit;

namespace CvApi.Tests;

// Schema mirror checks for inline links (US-EDIT-21 / spec §15). The TS model is
// the reference; these guard that the C# validator stays in sync.
public class ProfileDocumentSchemaTests
{
    private static BlockNode Root(params BlockNode[] children) =>
        new() { Type = "root", Id = "r", Children = [.. children] };

    private static BlockNode Paragraph(params BlockNode[] runs) =>
        new() { Type = "paragraph", Id = "p", Children = [.. runs] };

    [Fact]
    public void InlineLink_IsAllowed_InsideParagraph()
    {
        var body = Root(Paragraph(
            new BlockNode { Type = "text", Id = "t1", Attrs = { ["text"] = "See my " } },
            new BlockNode { Type = "inlineLink", Id = "l1", Attrs = { ["text"] = "site", ["url"] = "https://me.dev" } },
            new BlockNode { Type = "text", Id = "t2", Attrs = { ["text"] = "." } }));

        Assert.Null(ProfileDocumentSchema.Validate(body));
    }

    [Fact]
    public void InlineLink_IsRejected_AtRootLevel()
    {
        var body = Root(new BlockNode { Type = "inlineLink", Id = "l1", Attrs = { ["url"] = "https://x.dev" } });

        var error = ProfileDocumentSchema.Validate(body);
        Assert.NotNull(error);
        Assert.Contains("inlineLink", error);
    }

    [Fact]
    public void InlineLink_IsRecognised_AsAKnownType()
    {
        Assert.True(ProfileDocumentSchema.IsKnownType("inlineLink"));
    }

    // ---------------------------------------------------------------------
    // Standalone `link` block retired: legacy links migrate to
    // paragraph > inlineLink (the paragraph keeps the link's id).
    // ---------------------------------------------------------------------

    /// <summary>
    /// Calls <c>ProfileDocumentSchema.MigrateLegacy(ProfileDocument)</c>, the single
    /// legacy migration covering both <c>section</c> and <c>link</c>.
    /// </summary>
    private static ProfileDocument MigrateLegacy(ProfileDocument doc) =>
        ProfileDocumentSchema.MigrateLegacy(doc);

    private static ProfileDocument Doc(params BlockNode[] rootChildren) =>
        new() { Header = new ProfileHeader { FullName = "Ada" }, Body = Root(rootChildren) };

    private static BlockNode LegacyLink(string id, string text, string url) =>
        new() { Type = "link", Id = id, Attrs = { ["text"] = text, ["url"] = url } };

    private static IEnumerable<BlockNode> All(BlockNode n) =>
        new[] { n }.Concat(n.Children.SelectMany(All));

    private static void AssertParagraphWithInlineLink(BlockNode? para, string id, string text, string url)
    {
        Assert.NotNull(para);
        Assert.Equal("paragraph", para!.Type);
        Assert.Equal(id, para.Id);
        var run = Assert.Single(para.Children);
        Assert.Equal("inlineLink", run.Type);
        Assert.Equal(text, run.Attrs["text"]);
        Assert.Equal(url, run.Attrs["url"]);
        Assert.False(string.IsNullOrEmpty(run.Id));
        Assert.NotEqual(id, run.Id);
    }

    [Fact]
    public void Link_IsNoLongerAKnownType()
    {
        Assert.False(ProfileDocumentSchema.IsKnownType("link"));
    }

    [Fact]
    public void Link_IsRejected_AtRoot()
    {
        var error = ProfileDocumentSchema.Validate(Root(LegacyLink("l1", "Site", "https://s.dev")));
        Assert.NotNull(error);
        Assert.Contains("link", error);
    }

    [Fact]
    public void Link_IsRejected_InsideListItemAndEntry()
    {
        var listBody = Root(new BlockNode
        {
            Type = "list", Id = "list",
            Children = [new BlockNode { Type = "listItem", Id = "li", Children = [LegacyLink("l1", "R", "https://r.dev")] }],
        });
        Assert.NotNull(ProfileDocumentSchema.Validate(listBody));

        var entryBody = Root(new BlockNode
        {
            Type = "timeline", Id = "tl",
            Children =
            [
                new BlockNode
                {
                    Type = "entry", Id = "e",
                    Attrs = { ["title"] = "Eng", ["dates"] = "2022" },
                    Children = [LegacyLink("l2", "C", "https://c.dev")],
                },
            ],
        });
        Assert.NotNull(ProfileDocumentSchema.Validate(entryBody));
    }

    [Fact]
    public void MigrateLegacy_RootLink_BecomesParagraphWithInlineLink()
    {
        var doc = Doc(
            new BlockNode { Type = "title", Id = "t", Attrs = { ["text"] = "Links" } },
            LegacyLink("L1", "Portfolio", "https://example.com"));

        var migrated = MigrateLegacy(doc);

        Assert.Equal(["title", "paragraph"], migrated.Body.Children.Select(c => c.Type));
        AssertParagraphWithInlineLink(migrated.Body.Children[1], "L1", "Portfolio", "https://example.com");
        Assert.Null(ProfileDocumentSchema.Validate(migrated.Body));
    }

    [Fact]
    public void MigrateLegacy_LinkInsideListItem_IsMigrated()
    {
        var doc = Doc(new BlockNode
        {
            Type = "list", Id = "list",
            Children =
            [
                new BlockNode
                {
                    Type = "listItem", Id = "li",
                    Children =
                    [
                        Paragraph(new BlockNode { Type = "text", Id = "t", Attrs = { ["text"] = "Top" } }),
                        LegacyLink("L2", "Ref", "https://r.dev"),
                    ],
                },
            ],
        });

        var migrated = MigrateLegacy(doc);

        Assert.DoesNotContain(All(migrated.Body), n => n.Type == "link");
        AssertParagraphWithInlineLink(All(migrated.Body).FirstOrDefault(n => n.Id == "L2"), "L2", "Ref", "https://r.dev");
        Assert.Null(ProfileDocumentSchema.Validate(migrated.Body));
    }

    [Fact]
    public void MigrateLegacy_LinkInsideTimelineEntry_IsMigrated()
    {
        var doc = Doc(new BlockNode
        {
            Type = "timeline", Id = "tl",
            Children =
            [
                new BlockNode
                {
                    Type = "entry", Id = "e",
                    Attrs = { ["title"] = "Engineer", ["dates"] = "2022" },
                    Children = [LegacyLink("L3", "Case study", "https://case.dev")],
                },
            ],
        });

        var migrated = MigrateLegacy(doc);

        var entry = All(migrated.Body).Single(n => n.Type == "entry");
        AssertParagraphWithInlineLink(entry.Children.SingleOrDefault(n => n.Id == "L3"), "L3", "Case study", "https://case.dev");
        Assert.Null(ProfileDocumentSchema.Validate(migrated.Body));
    }

    [Fact]
    public void MigrateLegacy_EmptyText_UsesUrlAsLabel()
    {
        var migrated = MigrateLegacy(Doc(LegacyLink("L4", "", "https://me.dev")));

        AssertParagraphWithInlineLink(migrated.Body.Children.Single(), "L4", "https://me.dev", "https://me.dev");
    }

    [Fact]
    public void MigrateLegacy_EmptyUrl_BecomesParagraphOfPlainText()
    {
        var migrated = MigrateLegacy(Doc(LegacyLink("L5", "Just text", "")));

        var para = Assert.Single(migrated.Body.Children);
        Assert.Equal("paragraph", para.Type);
        Assert.Equal("L5", para.Id);
        var run = Assert.Single(para.Children);
        Assert.Equal("text", run.Type);
        Assert.Equal("Just text", run.Attrs["text"]);
    }

    [Fact]
    public void MigrateLegacy_EmptyTextAndUrl_IsDropped()
    {
        var migrated = MigrateLegacy(Doc(
            new BlockNode { Type = "title", Id = "t", Attrs = { ["text"] = "Links" } },
            LegacyLink("L6", "", "")));

        Assert.Equal(["title"], migrated.Body.Children.Select(c => c.Type));
    }

    [Fact]
    public void MigrateLegacy_StillMigratesSections_AndLinksInsideThem()
    {
        var doc = Doc(new BlockNode
        {
            Type = "section", Id = "s1", Attrs = { ["heading"] = "Links" },
            Children = [LegacyLink("L7", "Site", "https://s.dev")],
        });

        var migrated = MigrateLegacy(doc);

        Assert.Equal(["title", "paragraph"], migrated.Body.Children.Select(c => c.Type));
        Assert.Equal("Links", migrated.Body.Children[0].Attrs["text"]);
        AssertParagraphWithInlineLink(migrated.Body.Children[1], "L7", "Site", "https://s.dev");
    }
}

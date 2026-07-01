using CvApi.Domain.Entities;
using Xunit;

namespace CvApi.Tests;

// US-PROF-6 — a newly created blank profile is seeded with a default CV template:
// four titled sections with empty scaffolding and no fake data. These guard the
// structure (F-PROF-6.2/6.3), the empty header (F-PROF-6.4) and schema validity
// (F-PROF-6.5) of ProfileDocument.DefaultTemplate().
public class DefaultTemplateTests
{
    private static List<BlockNode> Body() => ProfileDocument.DefaultTemplate().Body.Children;

    [Fact]
    public void DefaultTemplate_BodyPassesSchemaValidation()
    {
        Assert.Null(ProfileDocumentSchema.Validate(ProfileDocument.DefaultTemplate().Body));
    }

    [Fact]
    public void DefaultTemplate_HasFourSectionTitlesInOrder()
    {
        var titles = Body()
            .Where(n => n.Type == "title")
            .Select(n => n.Attrs.GetValueOrDefault("text"))
            .ToList();

        Assert.Equal(
            new[] { "Professional Summary", "Work Experience", "Education", "Skills" },
            titles);
    }

    [Fact]
    public void DefaultTemplate_HasExpectedScaffoldingShapes()
    {
        var body = Body();

        // Order: title, paragraph, title, timeline, title, timeline, title, chips.
        Assert.Collection(body,
            n => Assert.Equal("title", n.Type),
            n => Assert.Equal("paragraph", n.Type),
            n => Assert.Equal("title", n.Type),
            n => Assert.Equal("timeline", n.Type),
            n => Assert.Equal("title", n.Type),
            n => Assert.Equal("timeline", n.Type),
            n => Assert.Equal("title", n.Type),
            n => Assert.Equal("chips", n.Type));

        // Each timeline carries exactly one empty entry with a paragraph child.
        foreach (var timeline in body.Where(n => n.Type == "timeline"))
        {
            var entry = Assert.Single(timeline.Children);
            Assert.Equal("entry", entry.Type);
            Assert.Equal(string.Empty, entry.Attrs.GetValueOrDefault("title", string.Empty));
            Assert.Contains(entry.Children, c => c.Type == "paragraph");
        }
    }

    [Fact]
    public void DefaultTemplate_HeaderAndContentCarryNoFakeData()
    {
        var doc = ProfileDocument.DefaultTemplate();

        Assert.Equal(string.Empty, doc.Header.FullName);
        Assert.Equal(string.Empty, doc.Header.Title);
        Assert.Equal(string.Empty, doc.Header.Email);
        Assert.Equal(string.Empty, doc.Header.Phone);
        Assert.Equal(string.Empty, doc.Header.Location);

        // Only the four section headings carry text; no other node has content.
        var chips = doc.Body.Children.Single(n => n.Type == "chips");
        Assert.Empty(chips.Children);
    }

    [Fact]
    public void DefaultTemplate_AssignsIdToEveryNode()
    {
        void AssertHasId(BlockNode node)
        {
            Assert.False(string.IsNullOrWhiteSpace(node.Id));
            foreach (var child in node.Children) AssertHasId(child);
        }

        AssertHasId(ProfileDocument.DefaultTemplate().Body);
    }
}

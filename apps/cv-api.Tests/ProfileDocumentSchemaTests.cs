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
}

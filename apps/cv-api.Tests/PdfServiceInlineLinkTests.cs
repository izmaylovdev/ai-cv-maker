using CvApi.Domain.Entities;
using CvApi.Infrastructure.ExternalServices.Pdf;
using Xunit;

namespace CvApi.Tests;

// Smoke test for inline-link PDF rendering (US-EDIT-21 / spec §15): a paragraph
// mixing plain text and inline-link runs must render without throwing through the
// QuestPDF rich-text API (a misuse of Span/Hyperlink would throw at compose time).
public class PdfServiceInlineLinkTests
{
    [Fact]
    public void RendersParagraphWithInlineLink()
    {
        QuestPDF.Settings.License = QuestPDF.Infrastructure.LicenseType.Community;

        var doc = new ProfileDocument
        {
            Header = new ProfileHeader { FullName = "Jane Doe", Title = "Engineer", Email = "j@x.com" },
            Body = new BlockNode
            {
                Type = "root",
                Children =
                [
                    new BlockNode { Type = "title", Attrs = { ["text"] = "Summary" } },
                    new BlockNode
                    {
                        Type = "paragraph",
                        Children =
                        [
                            new BlockNode { Type = "text", Attrs = { ["text"] = "See my " } },
                            new BlockNode { Type = "inlineLink", Attrs = { ["text"] = "portfolio", ["url"] = "https://me.dev" } },
                            new BlockNode { Type = "text", Attrs = { ["text"] = " for details." } },
                        ],
                    },
                ],
            },
        };

        var bytes = new PdfService().GenerateFromDocument(doc);
        Assert.True(bytes.Length > 0);
    }
}

using CvApi.Domain.Entities;
using CvApi.Infrastructure.ExternalServices.Pdf;
using Xunit;

namespace CvApi.Tests;

// Smoke test for chip PDF rendering (spec §13 / §14): chip pills use a rounded-rect
// SVG background layer (QuestPDF has no corner-radius primitive). A malformed SVG or
// Layers/Svg misuse would throw at compose time, so a successful render guards the
// pill rendering for both standalone chip-lists and chips nested in a timeline entry.
public class PdfServiceChipsTests
{
    [Fact]
    public void RendersStandaloneAndTimelineNestedChips()
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
                    new BlockNode { Type = "title", Attrs = { ["text"] = "Skills" } },
                    Chips("TypeScript", "React", "PostgreSQL"),
                    new BlockNode { Type = "title", Attrs = { ["text"] = "Experience" } },
                    new BlockNode
                    {
                        Type = "timeline",
                        Children =
                        [
                            new BlockNode
                            {
                                Type = "entry",
                                Attrs = { ["title"] = "Senior Engineer", ["dates"] = "2022 – Present" },
                                Children =
                                [
                                    new BlockNode { Type = "paragraph", Children = [Text("Led the platform team.")] },
                                    Chips("gRPC", "Docker"),
                                ],
                            },
                        ],
                    },
                ],
            },
        };

        var bytes = new PdfService().GenerateFromDocument(doc);
        Assert.True(bytes.Length > 0);
    }

    private static BlockNode Chips(params string[] texts) => new()
    {
        Type = "chips",
        Children = [.. texts.Select(t => new BlockNode { Type = "chip", Attrs = { ["text"] = t } })],
    };

    private static BlockNode Text(string text) =>
        new() { Type = "text", Attrs = { ["text"] = text } };
}

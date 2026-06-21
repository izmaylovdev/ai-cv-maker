using CvApi.Domain.Entities;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace CvApi.Infrastructure.ExternalServices.Pdf;

public class PdfService : IPdfService
{
    public byte[] GenerateFromDocument(ProfileDocument doc)
    {
        return Document.Create(container =>
        {
            container.Page(page =>
            {
                page.Size(PageSizes.A4);
                page.Margin(40);
                page.DefaultTextStyle(x => x.FontSize(10).FontFamily("Arial"));
                page.Content().Column(col => BuildDocumentContent(col, doc));
            });
        }).GeneratePdf();
    }

    private static void BuildDocumentContent(ColumnDescriptor col, ProfileDocument doc)
    {
        col.Spacing(16);

        var header = doc.Header;
        col.Item().Row(row =>
        {
            row.RelativeItem().Column(nameCol =>
            {
                nameCol.Item().Text(header.FullName).Bold().FontSize(24).FontColor(Colors.Blue.Darken3);
                if (!string.IsNullOrWhiteSpace(header.Title))
                    nameCol.Item().Text(header.Title).FontSize(13).FontColor(Colors.Grey.Darken1);
                if (!string.IsNullOrWhiteSpace(header.Location))
                    nameCol.Item().PaddingTop(2).Text(header.Location).FontSize(10).FontColor(Colors.Grey.Darken2);
            });

            var contactParts = new List<string>();
            if (!string.IsNullOrWhiteSpace(header.Email)) contactParts.Add(header.Email);
            if (!string.IsNullOrWhiteSpace(header.Phone)) contactParts.Add(header.Phone);
            if (contactParts.Count > 0)
            {
                row.AutoItem().AlignRight().AlignBottom().Column(contactCol =>
                {
                    foreach (var part in contactParts)
                        contactCol.Item().AlignRight().Text(part).FontSize(9).FontColor(Colors.Grey.Darken2);
                });
            }
        });

        col.Item().LineHorizontal(1).LineColor(Colors.Blue.Darken3);

        foreach (var section in doc.Sections)
            col.Item().Column(s => BuildSection(s, section));
    }

    // One canonical section → heading + template-specific content. Empty sections
    // are skipped; an unknown template renders heading only (graceful degradation).
    private static void BuildSection(ColumnDescriptor col, DocumentSection section)
    {
        switch (section.Template)
        {
            case "free-form":
                if (string.IsNullOrWhiteSpace(section.Body)) return;
                SectionHeading(col, section.Heading);
                col.Item().PaddingTop(4).Text(section.Body);
                break;

            case "timeline":
                var entries = (section.Items ?? [])
                    .Where(i => !string.IsNullOrWhiteSpace(i.Title)
                                || !string.IsNullOrWhiteSpace(i.Dates)
                                || !string.IsNullOrWhiteSpace(i.Description))
                    .ToList();
                if (entries.Count == 0) return;
                SectionHeading(col, section.Heading);
                col.Item().LineHorizontal(0.5f).LineColor(Colors.Grey.Lighten1);
                foreach (var item in entries)
                {
                    col.Item().PaddingTop(6).Column(e =>
                    {
                        e.Item().Row(r =>
                        {
                            r.RelativeItem().Text(item.Title ?? string.Empty).Bold();
                            if (!string.IsNullOrWhiteSpace(item.Dates))
                                r.AutoItem().Text(item.Dates).FontColor(Colors.Grey.Darken1);
                        });
                        if (!string.IsNullOrWhiteSpace(item.Description))
                            e.Item().PaddingTop(2).Text(item.Description);
                    });
                }
                break;

            case "list":
                var bullets = (section.Items ?? [])
                    .Select(i => (i.Text ?? string.Empty).Trim())
                    .Where(t => t.Length > 0)
                    .ToList();
                if (bullets.Count == 0) return;
                SectionHeading(col, section.Heading);
                col.Item().LineHorizontal(0.5f).LineColor(Colors.Grey.Lighten1);
                foreach (var text in bullets)
                {
                    col.Item().PaddingTop(2).Row(r =>
                    {
                        r.ConstantItem(12).Text("•");
                        r.RelativeItem().Text(text);
                    });
                }
                break;

            case "chip-list":
                // Same text items as "list", rendered as wrapping chips/tags.
                var chips = (section.Items ?? [])
                    .Select(i => (i.Text ?? string.Empty).Trim())
                    .Where(t => t.Length > 0)
                    .ToList();
                if (chips.Count == 0) return;
                SectionHeading(col, section.Heading);
                col.Item().LineHorizontal(0.5f).LineColor(Colors.Grey.Lighten1);
                col.Item().PaddingTop(6).Inlined(inlined =>
                {
                    inlined.Spacing(6);
                    foreach (var text in chips)
                    {
                        inlined.Item()
                            .Background(Colors.Grey.Lighten3)
                            .PaddingVertical(3).PaddingHorizontal(9)
                            .Text(text).FontSize(9);
                    }
                });
                break;

            default:
                // Unknown template: render the heading only, nothing else.
                if (!string.IsNullOrWhiteSpace(section.Heading))
                    SectionHeading(col, section.Heading);
                break;
        }
    }

    private static void SectionHeading(ColumnDescriptor col, string heading) =>
        col.Item().Text(heading).Bold().FontSize(12).FontColor(Colors.Blue.Darken3);
}

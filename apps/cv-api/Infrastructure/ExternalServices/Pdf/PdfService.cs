using CvApi.Infrastructure.ExternalServices.Llm;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace CvApi.Infrastructure.ExternalServices.Pdf;

public class PdfService : IPdfService
{
    public byte[] GenerateCv(LlmGenerateResponse cv, string fullName, string title, string? location = null, string? contactEmail = null, string? contactPhone = null, IList<string>? sectionOrder = null)
    {
        return Document.Create(container =>
        {
            container.Page(page =>
            {
                page.Size(PageSizes.A4);
                page.Margin(40);
                page.DefaultTextStyle(x => x.FontSize(10).FontFamily("Arial"));
                page.Content().Column(col => BuildContent(col, cv, fullName, title, location, contactEmail, contactPhone, sectionOrder));
            });
        }).GeneratePdf();
    }

    private static void BuildContent(
        ColumnDescriptor col,
        LlmGenerateResponse cv,
        string fullName,
        string title,
        string? location,
        string? contactEmail,
        string? contactPhone,
        IList<string>? sectionOrder)
    {
        col.Spacing(16);

        col.Item().Row(row =>
        {
            row.RelativeItem().Column(nameCol =>
            {
                nameCol.Item().Text(fullName).Bold().FontSize(24).FontColor(Colors.Blue.Darken3);
                nameCol.Item().Text(title).FontSize(13).FontColor(Colors.Grey.Darken1);
                if (!string.IsNullOrWhiteSpace(location))
                    nameCol.Item().PaddingTop(2).Text(location).FontSize(10).FontColor(Colors.Grey.Darken2);
            });

            var contactParts = new List<string>();
            if (!string.IsNullOrWhiteSpace(contactEmail)) contactParts.Add(contactEmail);
            if (!string.IsNullOrWhiteSpace(contactPhone)) contactParts.Add(contactPhone);
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

        if (!string.IsNullOrWhiteSpace(cv.Summary))
            col.Item().Column(s => BuildSummary(s, cv.Summary));

        if (cv.Highlights.Count > 0)
            col.Item().Column(h => BuildHighlights(h, cv.Highlights));

        var order = sectionOrder ?? ["workExperiences", "educations", "skills"];
        foreach (var section in order)
        {
            switch (section)
            {
                case "workExperiences" when cv.WorkExperiences.Count > 0:
                    col.Item().Column(w => BuildWorkExperiences(w, cv.WorkExperiences));
                    break;
                case "educations" when cv.Educations.Count > 0:
                    col.Item().Column(ed => BuildEducations(ed, cv.Educations));
                    break;
                case "skills" when cv.Skills.Count > 0:
                    col.Item().Column(sk => BuildSkills(sk, cv.Skills));
                    break;
            }
        }
    }

    private static void BuildSummary(ColumnDescriptor col, string summary)
    {
        col.Item().Text("Professional Summary").Bold().FontSize(12).FontColor(Colors.Blue.Darken3);
        col.Item().PaddingTop(4).Text(summary);
    }

    private static void BuildHighlights(ColumnDescriptor col, List<string> highlights)
    {
        col.Item().Text("Key Highlights").Bold().FontSize(12).FontColor(Colors.Blue.Darken3);
        foreach (var highlight in highlights)
        {
            col.Item().Row(r =>
            {
                r.ConstantItem(12).Text("•");
                r.RelativeItem().Text(highlight);
            });
        }
    }

    private static void BuildWorkExperiences(ColumnDescriptor col, List<LlmWorkExperience> experiences)
    {
        col.Item().Text("Work Experience").Bold().FontSize(12).FontColor(Colors.Blue.Darken3);
        col.Item().LineHorizontal(0.5f).LineColor(Colors.Grey.Lighten1);
        foreach (var exp in experiences)
        {
            col.Item().PaddingTop(6).Column(e =>
            {
                e.Item().Row(r =>
                {
                    r.RelativeItem().Text(exp.Role).Bold();
                    r.AutoItem().Text(exp.Period).FontColor(Colors.Grey.Darken1);
                });
                e.Item().Text(exp.Company).FontColor(Colors.Blue.Medium);
                e.Item().PaddingTop(2).Text(exp.Description);
            });
        }
    }

    private static void BuildEducations(ColumnDescriptor col, List<LlmEducation> educations)
    {
        col.Item().Text("Education").Bold().FontSize(12).FontColor(Colors.Blue.Darken3);
        col.Item().LineHorizontal(0.5f).LineColor(Colors.Grey.Lighten1);
        foreach (var edu in educations)
        {
            col.Item().PaddingTop(6).Column(e =>
            {
                e.Item().Row(r =>
                {
                    r.RelativeItem().Text($"{edu.Degree} in {edu.Field}").Bold();
                    r.AutoItem().Text(edu.Period).FontColor(Colors.Grey.Darken1);
                });
                e.Item().Text(edu.Institution).FontColor(Colors.Blue.Medium);
            });
        }
    }

    private static void BuildSkills(ColumnDescriptor col, List<string> skills)
    {
        col.Item().Text("Skills").Bold().FontSize(12).FontColor(Colors.Blue.Darken3);
        col.Item().LineHorizontal(0.5f).LineColor(Colors.Grey.Lighten1);
        col.Item().PaddingTop(6).Text(string.Join("  •  ", skills));
    }
}

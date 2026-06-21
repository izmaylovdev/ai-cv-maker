using CvApi.Domain.Entities;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace CvApi.Infrastructure.ExternalServices.Pdf;

// Renders a canonical ProfileDocument (ADR-0014 §9.2/§9.5) to PDF via a recursive
// walk of the BlockNode tree — one handler per node type. Unknown or empty nodes
// are skipped (graceful degradation); recursion is bounded so a malformed/deep
// tree can never blow the stack. The walk assumes a tree that passed
// ProfileDocumentSchema validation but defends against bad data regardless.
public class PdfService : IPdfService
{
    // Hard cap on recursion depth; matches the schema's bounded depth (§9.3) with
    // headroom for the root/section wrappers. Beyond this, nodes are dropped.
    private const int MaxDepth = 12;

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

        BuildHeader(col, doc.Header);
        col.Item().LineHorizontal(1).LineColor(Colors.Blue.Darken3);

        // Body is a `root` node whose children are `section` nodes (§9.2). Walk
        // each top-level section; everything else flows recursively from there.
        var body = doc.Body;
        if (body is not null)
        {
            foreach (var section in body.Children)
            {
                if (section.Type == "section")
                    col.Item().Column(s => RenderSection(s, section, depth: 0));
            }
        }
    }

    private static void BuildHeader(ColumnDescriptor col, ProfileHeader header)
    {
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
    }

    // ---- Node handlers --------------------------------------------------------

    // section → heading + a flow of block widgets (paragraph/list/chips/timeline).
    // Skipped entirely if it produces no renderable content.
    private static void RenderSection(ColumnDescriptor col, BlockNode section, int depth)
    {
        var flow = section.Children.Where(IsRenderableFlow).ToList();
        var heading = Attr(section, "heading");
        if (flow.Count == 0 && string.IsNullOrWhiteSpace(heading))
            return;

        if (!string.IsNullOrWhiteSpace(heading))
            col.Item().Text(heading).Bold().FontSize(12).FontColor(Colors.Blue.Darken3);

        if (flow.Count == 0)
            return;

        col.Item().LineHorizontal(0.5f).LineColor(Colors.Grey.Lighten1);
        foreach (var node in flow)
            col.Item().PaddingTop(4).Column(c => RenderFlow(c, node, depth + 1));
    }

    // Dispatch a single flow-level node onto its handler.
    private static void RenderFlow(ColumnDescriptor col, BlockNode node, int depth)
    {
        if (depth > MaxDepth) return;
        switch (node.Type)
        {
            case "paragraph": RenderParagraph(col, node); break;
            case "list": RenderList(col, node, depth); break;
            case "chips": RenderChips(col, node); break;
            case "timeline": RenderTimeline(col, node, depth); break;
            // Unknown / unexpected node type: skip silently.
        }
    }

    // paragraph → a single text run (concatenated text children).
    private static void RenderParagraph(ColumnDescriptor col, BlockNode paragraph)
    {
        var text = ParagraphText(paragraph);
        if (!string.IsNullOrWhiteSpace(text))
            col.Item().Text(text);
    }

    // list → bullet rows; nested lists/paragraphs/chips inside a listItem are
    // rendered indented under the bullet (§9.3 allows paragraph/list/chips here).
    private static void RenderList(ColumnDescriptor col, BlockNode list, int depth)
    {
        if (depth > MaxDepth) return;
        foreach (var item in list.Children.Where(c => c.Type == "listItem"))
        {
            var blocks = item.Children
                .Where(b => b.Type is "paragraph" or "list" or "chips")
                .ToList();
            if (blocks.Count == 0) continue;

            col.Item().PaddingTop(2).Row(row =>
            {
                row.ConstantItem(12).Text("•");
                row.RelativeItem().Column(itemCol =>
                {
                    foreach (var block in blocks)
                    {
                        switch (block.Type)
                        {
                            case "paragraph": RenderParagraph(itemCol, block); break;
                            case "list": itemCol.Item().PaddingLeft(8).Column(c => RenderList(c, block, depth + 1)); break;
                            case "chips": RenderChips(itemCol, block); break;
                        }
                    }
                });
            });
        }
    }

    // chips → a wrapping row of tag pills.
    private static void RenderChips(ColumnDescriptor col, BlockNode chips)
    {
        var labels = chips.Children
            .Where(c => c.Type == "chip")
            .Select(c => Attr(c, "text").Trim())
            .Where(t => t.Length > 0)
            .ToList();
        if (labels.Count == 0) return;

        col.Item().PaddingTop(4).Inlined(inlined =>
        {
            inlined.Spacing(6);
            foreach (var label in labels)
            {
                inlined.Item()
                    .Background(Colors.Grey.Lighten3)
                    .PaddingVertical(3).PaddingHorizontal(9)
                    .Text(label).FontSize(9);
            }
        });
    }

    // timeline → dated entries; each entry is title + dates then a rich description
    // (paragraph/list) rendered recursively (§9.3 entry children).
    private static void RenderTimeline(ColumnDescriptor col, BlockNode timeline, int depth)
    {
        if (depth > MaxDepth) return;
        foreach (var entry in timeline.Children.Where(c => c.Type == "entry"))
        {
            var title = Attr(entry, "title");
            var dates = Attr(entry, "dates");
            var description = entry.Children
                .Where(c => c.Type is "paragraph" or "list")
                .ToList();

            if (string.IsNullOrWhiteSpace(title)
                && string.IsNullOrWhiteSpace(dates)
                && description.All(d => string.IsNullOrWhiteSpace(NodeText(d))))
                continue;

            col.Item().PaddingTop(6).Column(e =>
            {
                e.Item().Row(r =>
                {
                    r.RelativeItem().Text(title).Bold();
                    if (!string.IsNullOrWhiteSpace(dates))
                        r.AutoItem().Text(dates).FontColor(Colors.Grey.Darken1);
                });
                foreach (var block in description)
                {
                    if (block.Type == "paragraph")
                        e.Item().PaddingTop(2).Column(c => RenderParagraph(c, block));
                    else if (block.Type == "list")
                        e.Item().PaddingTop(2).Column(c => RenderList(c, block, depth + 1));
                }
            });
        }
    }

    // ---- Helpers --------------------------------------------------------------

    // A flow node contributes content if it (recursively) carries any non-empty
    // text or chip. Empty widgets are dropped so the section can skip its divider.
    private static bool IsRenderableFlow(BlockNode node) =>
        node.Type is "paragraph" or "list" or "chips" or "timeline"
        && !string.IsNullOrWhiteSpace(NodeText(node));

    private static string Attr(BlockNode node, string key) =>
        node.Attrs.TryGetValue(key, out var v) ? v ?? string.Empty : string.Empty;

    private static string ParagraphText(BlockNode paragraph) =>
        string.Concat(paragraph.Children.Where(c => c.Type == "text").Select(c => Attr(c, "text")));

    // All renderable plain text reachable under a node (used for emptiness checks).
    private static string NodeText(BlockNode node)
    {
        if (node.Type == "text") return Attr(node, "text");
        if (node.Type == "chip") return Attr(node, "text");
        if (node.Type is "section" or "entry")
        {
            var head = Attr(node, "heading") + Attr(node, "title");
            return head + string.Concat(node.Children.Select(NodeText));
        }
        return string.Concat(node.Children.Select(NodeText));
    }
}

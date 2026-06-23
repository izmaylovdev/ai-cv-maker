using CvApi.Domain.Entities;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace CvApi.Infrastructure.ExternalServices.Pdf;

// Renders a canonical ProfileDocument (ADR-0014 §9.2/§9.5/§13) to PDF via a
// recursive walk of the BlockNode tree — one handler per node type. Unknown or
// empty nodes are skipped (graceful degradation); recursion is bounded so a
// malformed/deep tree can never blow the stack. The walk assumes a tree that
// passed ProfileDocumentSchema validation but defends against bad data regardless.
// US-EDIT-19: body is now a flat list of title/flow nodes; 'section' is retired.
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

        // Body is a `root` node whose children are flat title/flow nodes (§13).
        // A `title` node renders as a bold section heading + rule; flow nodes
        // render directly. Legacy `section` nodes are handled for graceful
        // degradation of stored documents not yet migrated by the client.
        var body = doc.Body;
        if (body is not null)
        {
            foreach (var node in body.Children)
            {
                switch (node.Type)
                {
                    case "title":
                        col.Item().Column(c => RenderTitle(c, node));
                        break;
                    case "section":
                        // Legacy fallback: render as title + children.
                        col.Item().Column(c => RenderSection(c, node, depth: 0));
                        break;
                    default:
                        if (IsRenderableFlow(node))
                            col.Item().PaddingTop(4).Column(c => RenderFlow(c, node, depth: 1));
                        break;
                }
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

    // title → bold heading with a rule below (US-EDIT-19 §13.2.7).
    private static void RenderTitle(ColumnDescriptor col, BlockNode title)
    {
        var text = Attr(title, "text").Trim();
        if (string.IsNullOrWhiteSpace(text)) return;
        col.Item().PaddingTop(8).Text(text).Bold().FontSize(12).FontColor(Colors.Blue.Darken3);
        col.Item().LineHorizontal(0.5f).LineColor(Colors.Grey.Lighten1);
    }

    // section → heading + a flow of block widgets. Legacy fallback only.
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
            case "link": RenderLink(col, node); break;
            // Unknown / unexpected node type: skip silently.
        }
    }

    // link → a standalone hyperlink line (spec §10). Shows the display text (or the
    // url when no text), linked to the url when it is a safe http(s)/mailto target.
    private static void RenderLink(ColumnDescriptor col, BlockNode link)
    {
        var url = Attr(link, "url").Trim();
        var label = Attr(link, "text").Trim();
        if (label.Length == 0) label = url;
        if (label.Length == 0) return;

        var href = SafeHref(url);
        var item = col.Item().PaddingTop(2);
        if (href is not null) item = item.Hyperlink(href);
        item.Text(label).FontColor(Colors.Blue.Medium).Underline();
    }

    // Only surface http(s)/mailto links as clickable; bare domains get https://.
    private static string? SafeHref(string url)
    {
        if (url.Length == 0) return null;
        if (System.Text.RegularExpressions.Regex.IsMatch(url, "^(https?:|mailto:)", System.Text.RegularExpressions.RegexOptions.IgnoreCase))
            return url;
        if (System.Text.RegularExpressions.Regex.IsMatch(url, @"^[\w.-]+\.[a-z]{2,}", System.Text.RegularExpressions.RegexOptions.IgnoreCase))
            return "https://" + url;
        return null;
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
                .Where(b => b.Type is "paragraph" or "list" or "chips" or "link")
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
                            case "link": RenderLink(itemCol, block); break;
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
                .Where(c => c.Type is "paragraph" or "list" or "link")
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
                    else if (block.Type == "link")
                        e.Item().Column(c => RenderLink(c, block));
                }
            });
        }
    }

    // ---- Helpers --------------------------------------------------------------

    // A flow node contributes content if it (recursively) carries any non-empty
    // text or chip. Empty widgets are dropped so the section can skip its divider.
    private static bool IsRenderableFlow(BlockNode node) =>
        node.Type is "paragraph" or "list" or "chips" or "timeline" or "link"
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
        if (node.Type == "link") return Attr(node, "text") + Attr(node, "url");
        if (node.Type == "title") return Attr(node, "text");
        if (node.Type == "entry")
        {
            var head = Attr(node, "title");
            return head + string.Concat(node.Children.Select(NodeText));
        }
        return string.Concat(node.Children.Select(NodeText));
    }
}

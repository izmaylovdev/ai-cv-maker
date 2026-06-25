using System.Globalization;
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
        // Spacing here separates whole sections only. A title and its following
        // flow nodes are grouped into a single column (see below) so the heading
        // stays tight against its content instead of inheriting this gap.
        col.Spacing(16);

        BuildHeader(col, doc.Header);
        col.Item().LineHorizontal(1).LineColor(Colors.Blue.Darken3);

        // Body is a `root` node whose children are flat title/flow nodes (§13).
        // The flat model lists the title and its content as siblings, so we
        // re-group them: a `title` opens a section that owns every following flow
        // node until the next title. Each group renders as one column item, which
        // keeps the heading tight against its content (e.g. a Skills title and its
        // chips) while the document-level spacing separates sections. Legacy
        // `section` nodes are handled for graceful degradation of stored documents
        // not yet migrated by the client.
        var body = doc.Body;
        if (body is null) return;

        List<BlockNode>? group = null;
        void Flush()
        {
            if (group is { Count: > 0 })
            {
                var nodes = group;
                col.Item().Column(c => RenderTitleGroup(c, nodes));
            }
            group = null;
        }

        foreach (var node in body.Children)
        {
            switch (node.Type)
            {
                case "title":
                    Flush();
                    group = new List<BlockNode> { node };
                    break;
                case "section":
                    Flush();
                    col.Item().Column(c => RenderSection(c, node, depth: 0));
                    break;
                default:
                    if (IsRenderableFlow(node))
                    {
                        if (group is not null) group.Add(node);
                        else col.Item().Column(c => RenderFlow(c, node, depth: 1));
                    }
                    break;
            }
        }
        Flush();
    }

    // A title-anchored section: the heading (nodes[0]) followed by its flow
    // content, all in one column so they stay visually bound together.
    private static void RenderTitleGroup(ColumnDescriptor col, List<BlockNode> nodes)
    {
        RenderTitle(col, nodes[0]);
        for (var i = 1; i < nodes.Count; i++)
            col.Item().PaddingTop(4).Column(c => RenderFlow(c, nodes[i], depth: 1));
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
        col.Item().Text(text).Bold().FontSize(12).FontColor(Colors.Blue.Darken3);
        col.Item().PaddingTop(2).LineHorizontal(0.5f).LineColor(Colors.Grey.Lighten1);
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

    // paragraph → an inline text run: plain `text` spans interleaved with
    // `inlineLink` hyperlinks (spec §15). A link with an unsafe url falls back to
    // a plain span so its words still appear.
    private static void RenderParagraph(ColumnDescriptor col, BlockNode paragraph)
    {
        var runs = paragraph.Children.Where(c => c.Type is "text" or "inlineLink").ToList();
        if (string.IsNullOrWhiteSpace(ParagraphText(paragraph))) return;

        col.Item().Text(text =>
        {
            foreach (var run in runs)
            {
                if (run.Type == "inlineLink")
                {
                    var label = Attr(run, "text");
                    if (label.Length == 0) label = Attr(run, "url");
                    if (label.Length == 0) continue;
                    var href = SafeHref(Attr(run, "url").Trim());
                    if (href is not null)
                        text.Hyperlink(label, href).FontColor(Colors.Blue.Medium).Underline();
                    else
                        text.Span(label);
                }
                else
                {
                    text.Span(Attr(run, "text"));
                }
            }
        });
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

    // chips → a wrapping row of tag pills. `compact` renders a touch smaller for
    // chips nested inside a timeline entry, matching the editor (denser context).
    private static void RenderChips(ColumnDescriptor col, BlockNode chips, bool compact = false)
    {
        var labels = chips.Children
            .Where(c => c.Type == "chip")
            .Select(c => Attr(c, "text").Trim())
            .Where(t => t.Length > 0)
            .ToList();
        if (labels.Count == 0) return;

        var spacing = compact ? 5f : 6f;
        var padV = compact ? 2f : 3f;
        var padH = compact ? 7f : 9f;
        var fontSize = compact ? 8f : 9f;

        col.Item().PaddingTop(4).Inlined(inlined =>
        {
            inlined.Spacing(spacing);
            foreach (var label in labels)
            {
                // QuestPDF (2025.4.0) has no corner-radius primitive, so the pill
                // background is a rounded-rect SVG drawn behind the text and sized
                // to the laid-out item. rx = height/2 gives the editor's fully
                // rounded ends (CSS border-radius: 999px).
                inlined.Item().Layers(layers =>
                {
                    layers.Layer().Svg(size =>
                    {
                        var w = size.Width.ToString(CultureInfo.InvariantCulture);
                        var h = size.Height.ToString(CultureInfo.InvariantCulture);
                        var r = (size.Height / 2).ToString(CultureInfo.InvariantCulture);
                        return $"<svg width=\"{w}\" height=\"{h}\" viewBox=\"0 0 {w} {h}\" "
                            + $"xmlns=\"http://www.w3.org/2000/svg\"><rect width=\"{w}\" height=\"{h}\" "
                            + $"rx=\"{r}\" ry=\"{r}\" fill=\"#EEEEEE\"/></svg>";
                    });
                    layers.PrimaryLayer()
                        .PaddingVertical(padV).PaddingHorizontal(padH)
                        .Text(label).FontSize(fontSize);
                });
            }
        });
    }

    // timeline → dated entries; each entry is title + dates then a rich description
    // (paragraph/list/chips/link) rendered recursively (§9.3 / §14 entry children).
    private static void RenderTimeline(ColumnDescriptor col, BlockNode timeline, int depth)
    {
        if (depth > MaxDepth) return;
        foreach (var entry in timeline.Children.Where(c => c.Type == "entry"))
        {
            var title = Attr(entry, "title");
            var dates = Attr(entry, "dates");
            var description = entry.Children
                .Where(c => c.Type is "paragraph" or "list" or "chips" or "link")
                .ToList();

            if (string.IsNullOrWhiteSpace(title)
                && string.IsNullOrWhiteSpace(dates)
                && description.All(d => string.IsNullOrWhiteSpace(NodeText(d))))
                continue;

            col.Item().PaddingTop(10).Column(e =>
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
                    else if (block.Type == "chips")
                        e.Item().PaddingTop(2).Column(c => RenderChips(c, block, compact: true));
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

    // Visible text of a paragraph: plain runs plus inline-link labels (used for
    // the emptiness check; a link with only a url still counts via its url label).
    private static string ParagraphText(BlockNode paragraph) =>
        string.Concat(paragraph.Children.Select(c =>
            c.Type == "text" ? Attr(c, "text")
            : c.Type == "inlineLink" ? Attr(c, "text") + Attr(c, "url")
            : string.Empty));

    // All renderable plain text reachable under a node (used for emptiness checks).
    private static string NodeText(BlockNode node)
    {
        if (node.Type == "text") return Attr(node, "text");
        if (node.Type == "chip") return Attr(node, "text");
        if (node.Type is "link" or "inlineLink") return Attr(node, "text") + Attr(node, "url");
        if (node.Type == "title") return Attr(node, "text");
        if (node.Type == "entry")
        {
            var head = Attr(node, "title");
            return head + string.Concat(node.Children.Select(NodeText));
        }
        return string.Concat(node.Children.Select(NodeText));
    }
}

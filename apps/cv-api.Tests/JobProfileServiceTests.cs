using CvApi.Domain.Entities;
using CvApi.Features.JobProfiles;
using CvApi.Features.JobProfiles.Dtos;
using CvApi.Features.Usage;
using CvApi.Infrastructure.ExternalServices.Llm;
using Moq;

namespace CvApi.Tests;

// GetAsync must transparently upgrade legacy ADR-0013 section nodes to the
// ADR-0014 flat title+content layout so that a stored document never arrives
// at the client in a format the editor cannot render (US-EDIT-19).
public class JobProfileServiceTests
{
    private static InMemoryStore CreateDb() => new();

    private static UsageService MakeUsageService(InMemoryStore db)
        => new(db, db, db, db,
            Microsoft.Extensions.Options.Options.Create(new LlmPricingOptions()),
            Microsoft.Extensions.Options.Options.Create(new UsageLimitOptions()),
            Microsoft.Extensions.Options.Options.Create(new CvApi.Features.Billing.BillingOptions()));

    private static JobProfileService MakeService(InMemoryStore db)
        => new(db, new Mock<ILlmService>().Object, MakeUsageService(db));

    private static BlockNode Node(string type, Dictionary<string, string>? attrs = null, List<BlockNode>? children = null)
        => new() { Type = type, Id = Guid.NewGuid().ToString("n"), Attrs = attrs ?? [], Children = children ?? [] };

    // -------------------------------------------------------------------------
    // GetAsync — legacy section migration (US-EDIT-19 / ADR-0014)
    // -------------------------------------------------------------------------

    [Fact]
    public async Task GetAsync_MigratesLegacySectionNodesToTitlePlusChildren()
    {
        var userId = Guid.NewGuid();
        var db = CreateDb();

        // Profile stored in ADR-0013 section format (before the US-EDIT-19 migration).
        var paragraph = Node("paragraph", children: [Node("text", attrs: new() { ["text"] = "Python expert." })]);
        var legacyDoc = new ProfileDocument
        {
            Header = new ProfileHeader { FullName = "Ada Lovelace" },
            Body = new BlockNode
            {
                Type = "root",
                Id = "root-1",
                Children =
                [
                    new BlockNode
                    {
                        Type    = "section",
                        Id      = "s1",
                        Attrs   = new() { ["heading"] = "Summary" },
                        Children = [paragraph],
                    },
                ],
            },
        };
        var profile = new Profile { Id = Guid.NewGuid(), UserId = userId, Name = "Test", Document = legacyDoc };
        db.Profiles.Add(profile);
        await db.SaveChangesAsync();

        var result = await MakeService(db).GetAsync(profile.Id, userId);

        Assert.NotNull(result);
        var children = result!.Document.Body.Children;
        // section → flat [title, paragraph] — no wrapper node remains.
        Assert.Equal(2, children.Count);
        Assert.Equal("title",     children[0].Type);
        Assert.Equal("Summary",   children[0].Attrs["text"]);
        Assert.Equal("paragraph", children[1].Type);
    }

    [Fact]
    public async Task GetAsync_MigratesMultipleLegacySections()
    {
        var userId = Guid.NewGuid();
        var db = CreateDb();

        var chip = Node("chip", attrs: new() { ["text"] = "Go" });
        var legacyDoc = new ProfileDocument
        {
            Header = new ProfileHeader { FullName = "Alan Turing" },
            Body = new BlockNode
            {
                Type = "root",
                Id   = "root-1",
                Children =
                [
                    new BlockNode
                    {
                        Type     = "section",
                        Id       = "s1",
                        Attrs    = new() { ["heading"] = "Summary" },
                        Children = [Node("paragraph", children: [Node("text", attrs: new() { ["text"] = "Pioneer." })])],
                    },
                    new BlockNode
                    {
                        Type     = "section",
                        Id       = "s2",
                        Attrs    = new() { ["heading"] = "Skills" },
                        Children = [Node("chips", children: [chip])],
                    },
                ],
            },
        };
        var profile = new Profile { Id = Guid.NewGuid(), UserId = userId, Name = "Turing", Document = legacyDoc };
        db.Profiles.Add(profile);
        await db.SaveChangesAsync();

        var result = await MakeService(db).GetAsync(profile.Id, userId);

        Assert.NotNull(result);
        var children = result!.Document.Body.Children;
        // Two sections → [title, paragraph, title, chips] flat.
        Assert.Equal(4, children.Count);
        Assert.Equal("title",     children[0].Type);
        Assert.Equal("Summary",   children[0].Attrs["text"]);
        Assert.Equal("paragraph", children[1].Type);
        Assert.Equal("title",     children[2].Type);
        Assert.Equal("Skills",    children[2].Attrs["text"]);
        Assert.Equal("chips",     children[3].Type);
    }

    [Fact]
    public async Task GetAsync_LeavesAdt0014DocumentUnchanged()
    {
        var userId = Guid.NewGuid();
        var db = CreateDb();

        // Profile already in ADR-0014 format (title + flat content nodes).
        var doc = new ProfileDocument
        {
            Header = new ProfileHeader { FullName = "Ada Lovelace" },
            Body = new BlockNode
            {
                Type     = "root",
                Id       = "root-1",
                Children =
                [
                    new BlockNode { Type = "title", Id = "t1", Attrs = new() { ["text"] = "Summary" } },
                    Node("paragraph", children: [Node("text", attrs: new() { ["text"] = "Mathematician." })]),
                ],
            },
        };
        var profile = new Profile { Id = Guid.NewGuid(), UserId = userId, Name = "Test", Document = doc };
        db.Profiles.Add(profile);
        await db.SaveChangesAsync();

        var result = await MakeService(db).GetAsync(profile.Id, userId);

        Assert.NotNull(result);
        var children = result!.Document.Body.Children;
        Assert.Equal(2, children.Count);
        Assert.Equal("title",     children[0].Type);
        Assert.Equal("Summary",   children[0].Attrs["text"]);
        Assert.Equal("paragraph", children[1].Type);
    }

    // -------------------------------------------------------------------------
    // CreateAsync — default template seeding (US-PROF-6)
    // -------------------------------------------------------------------------

    [Fact]
    public async Task CreateAsync_SeedsDefaultCvTemplate()
    {
        var userId = Guid.NewGuid();
        var db = CreateDb();

        var created = await MakeService(db).CreateAsync(userId, new("Backend Role"));

        // Read the stored document back and assert it is the default template,
        // not an empty body.
        var stored = db.Profiles.Single(p => p.Id == created.Id);
        var titles = stored.Document.Body.Children
            .Where(n => n.Type == "title")
            .Select(n => n.Attrs.GetValueOrDefault("text"))
            .ToList();

        Assert.Equal(
            new[] { "Professional Summary", "Work Experience", "Education", "Skills" },
            titles);
        Assert.Null(ProfileDocumentSchema.Validate(stored.Document.Body));
        // No fake identity data seeded onto the header.
        Assert.Equal(string.Empty, stored.Document.Header.FullName);
    }

    // -------------------------------------------------------------------------
    // GetAsync — access control
    // -------------------------------------------------------------------------

    [Fact]
    public async Task GetAsync_ReturnsNullForUnknownProfile()
    {
        var db = CreateDb();
        var result = await MakeService(db).GetAsync(Guid.NewGuid(), Guid.NewGuid());
        Assert.Null(result);
    }

    [Fact]
    public async Task GetAsync_ReturnsNullWhenProfileBelongsToAnotherUser()
    {
        var ownerUserId = Guid.NewGuid();
        var otherUserId = Guid.NewGuid();
        var db = CreateDb();

        var profile = new Profile { Id = Guid.NewGuid(), UserId = ownerUserId, Name = "Owner", Document = ProfileDocument.Empty() };
        db.Profiles.Add(profile);
        await db.SaveChangesAsync();

        var result = await MakeService(db).GetAsync(profile.Id, otherUserId);
        Assert.Null(result);
    }

    // -------------------------------------------------------------------------
    // Legacy standalone `link` block -> paragraph > inlineLink (GET and PUT)
    // -------------------------------------------------------------------------

    private static ProfileDocument LegacyLinkDoc() => new()
    {
        Header = new ProfileHeader { FullName = "Ada Lovelace" },
        Body = new BlockNode
        {
            Type = "root",
            Id = "root-1",
            Children =
            [
                new BlockNode { Type = "title", Id = "t1", Attrs = new() { ["text"] = "Links" } },
                new BlockNode { Type = "link", Id = "L1", Attrs = new() { ["text"] = "Portfolio", ["url"] = "https://example.com" } },
            ],
        },
    };

    private static void AssertMigratedLink(ProfileDocument document)
    {
        var children = document.Body.Children;
        Assert.Equal(2, children.Count);
        Assert.Equal("paragraph", children[1].Type);
        Assert.Equal("L1", children[1].Id);
        var run = Assert.Single(children[1].Children);
        Assert.Equal("inlineLink", run.Type);
        Assert.Equal("Portfolio", run.Attrs["text"]);
        Assert.Equal("https://example.com", run.Attrs["url"]);
    }

    [Fact]
    public async Task GetAsync_MigratesLegacyLinkBlockToParagraphWithInlineLink()
    {
        var userId = Guid.NewGuid();
        var db = CreateDb();
        var profile = new Profile { Id = Guid.NewGuid(), UserId = userId, Name = "Test", Document = LegacyLinkDoc() };
        db.Profiles.Add(profile);
        await db.SaveChangesAsync();

        var result = await MakeService(db).GetAsync(profile.Id, userId);

        Assert.NotNull(result);
        AssertMigratedLink(result!.Document);
    }

    [Fact]
    public async Task UpdateAsync_MigratesLegacyLinkBlockBeforeValidation_AndPersistsInlineLink()
    {
        var userId = Guid.NewGuid();
        var db = CreateDb();
        var profile = new Profile { Id = Guid.NewGuid(), UserId = userId, Name = "Test", Document = ProfileDocument.Empty() };
        db.Profiles.Add(profile);
        await db.SaveChangesAsync();

        var result = await MakeService(db).UpdateAsync(profile.Id, userId, new UpdateProfileRequest("Test", LegacyLinkDoc()));

        Assert.NotNull(result);
        AssertMigratedLink(result!.Document);
        AssertMigratedLink(db.Profiles.Single(p => p.Id == profile.Id).Document);
    }
}

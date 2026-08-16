using CvApi.Domain.Entities;
using CvApi.Features.CoverLetter;
using CvApi.Features.Usage;
using CvApi.Infrastructure.ExternalServices.Llm;
using CvApi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Moq;

namespace CvApi.Tests;

public class CoverLetterServiceTests
{
    private static InMemoryStore CreateDb() => new();

    private static UsageService MakeUsageService(InMemoryStore db)
        => new(db, db, db, db,
            Microsoft.Extensions.Options.Options.Create(new LlmPricingOptions()),
            Microsoft.Extensions.Options.Options.Create(new UsageLimitOptions()),
            Microsoft.Extensions.Options.Options.Create(new CvApi.Features.Billing.BillingOptions()));

    // --- Block-tree node factories (ADR-0014; mirror profile-builder-ui/src/nodes.ts) ---

    private static BlockNode Node(string type, Dictionary<string, string>? attrs = null, List<BlockNode>? children = null)
        => new()
        {
            Type = type,
            Id = Guid.NewGuid().ToString("n"),
            Attrs = attrs ?? [],
            Children = children ?? [],
        };

    private static BlockNode TextNode(string text)
        => Node("text", attrs: new() { ["text"] = text });

    private static BlockNode ParagraphNode(string text)
        => Node("paragraph", children: [TextNode(text)]);

    private static BlockNode ChipNode(string text)
        => Node("chip", attrs: new() { ["text"] = text });

    private static BlockNode TitleNode(string text)
        => Node("title", attrs: new() { ["text"] = text });

    private static Profile MakeProfile(Guid userId, string title, string overview)
        => new()
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            Name = title,
            // ADR-0014 §13 (US-EDIT-19): body is a flat list of title/flow nodes.
            Document = new ProfileDocument
            {
                Header = new ProfileHeader { FullName = "Jane Doe", Title = title },
                Body = Node("root", children:
                [
                    TitleNode("Summary"),
                    ParagraphNode(overview),
                    TitleNode("Skills"),
                    Node("chips", children: [ChipNode("Python"), ChipNode("Go")]),
                ]),
            },
        };

    // -------------------------------------------------------------------------
    // GenerateAsync — returns text and selectedProfileId
    // -------------------------------------------------------------------------

    [Fact]
    public async Task GenerateAsync_ReturnsCoverLetterText()
    {
        var userId = Guid.NewGuid();
        var db = CreateDb();
        var profile = MakeProfile(userId, "Backend Engineer", "8 years backend.");
        db.Profiles.Add(profile);
        await db.SaveChangesAsync();

        var llm = new Mock<ILlmService>();
        llm.Setup(s => s.GenerateCoverLetterAsync(It.IsAny<LlmCoverLetterRequest>()))
           .ReturnsAsync(new LlmCoverLetterResponse("Dear Hiring Manager...", profile.Id));

        var svc = new CoverLetterService(db, db, llm.Object, MakeUsageService(db));
        var result = await svc.GenerateAsync(userId, new GenerateCoverLetterRequest(
            JobTitle: "Senior Python Engineer",
            JobDescription: "We need Python/Go expertise.",
            FieldContext: "cover letter",
            ProfileIdOverride: null
        ));

        Assert.Equal("Dear Hiring Manager...", result.Text);
        Assert.Equal(profile.Id, result.SelectedProfileId);
    }

    // -------------------------------------------------------------------------
    // GenerateAsync — 422 when user has no profiles
    // -------------------------------------------------------------------------

    [Fact]
    public async Task GenerateAsync_ThrowsWhenNoProfiles()
    {
        var userId = Guid.NewGuid();
        var db = CreateDb();

        var llm = new Mock<ILlmService>();
        var svc = new CoverLetterService(db, db, llm.Object, MakeUsageService(db));

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            svc.GenerateAsync(userId, new GenerateCoverLetterRequest(
                JobTitle: "Any",
                JobDescription: "Any",
                FieldContext: "cover letter",
                ProfileIdOverride: null
            )));
    }

    // -------------------------------------------------------------------------
    // GenerateAsync — profileIdOverride not belonging to user throws
    // -------------------------------------------------------------------------

    [Fact]
    public async Task GenerateAsync_ThrowsWhenOverrideProfileNotOwned()
    {
        var userId = Guid.NewGuid();
        var otherUserId = Guid.NewGuid();
        var db = CreateDb();
        var otherProfile = MakeProfile(otherUserId, "Frontend Dev", "React developer.");
        db.Profiles.Add(otherProfile);
        await db.SaveChangesAsync();

        var llm = new Mock<ILlmService>();
        var svc = new CoverLetterService(db, db, llm.Object, MakeUsageService(db));

        await Assert.ThrowsAsync<KeyNotFoundException>(() =>
            svc.GenerateAsync(userId, new GenerateCoverLetterRequest(
                JobTitle: "Any",
                JobDescription: "Any",
                FieldContext: "cover letter",
                ProfileIdOverride: otherProfile.Id
            )));
    }

    // -------------------------------------------------------------------------
    // GenerateAsync — passes all profiles to LLM when no override
    // -------------------------------------------------------------------------

    [Fact]
    public async Task GenerateAsync_PassesAllProfilesToLlm()
    {
        var userId = Guid.NewGuid();
        var db = CreateDb();
        var p1 = MakeProfile(userId, "Backend Engineer", "Python/Go expert.");
        var p2 = MakeProfile(userId, "Frontend Developer", "React specialist.");
        db.Profiles.AddRange(p1, p2);
        await db.SaveChangesAsync();

        LlmCoverLetterRequest? captured = null;
        var llm = new Mock<ILlmService>();
        llm.Setup(s => s.GenerateCoverLetterAsync(It.IsAny<LlmCoverLetterRequest>()))
           .Callback<LlmCoverLetterRequest>(r => captured = r)
           .ReturnsAsync(new LlmCoverLetterResponse("Cover letter text.", p1.Id));

        var svc = new CoverLetterService(db, db, llm.Object, MakeUsageService(db));
        await svc.GenerateAsync(userId, new GenerateCoverLetterRequest(
            JobTitle: "Engineer",
            JobDescription: "Backend role.",
            FieldContext: "cover letter",
            ProfileIdOverride: null
        ));

        Assert.NotNull(captured);
        Assert.Equal(2, captured!.Profiles.Count);
    }
}

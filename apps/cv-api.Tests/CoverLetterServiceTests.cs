using CvApi.Domain.Entities;
using CvApi.Features.CoverLetter;
using CvApi.Infrastructure.ExternalServices.Llm;
using CvApi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Moq;

namespace CvApi.Tests;

public class CoverLetterServiceTests
{
    private static AppDbContext CreateDb()
    {
        var opts = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new AppDbContext(opts);
    }

    private static Profile MakeProfile(Guid userId, string title, string overview)
        => new()
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            Name = title,
            FullName = "Jane Doe",
            Title = title,
            Overview = overview,
            Skills = [new Skill { Name = "Python" }, new Skill { Name = "Go" }],
        };

    // -------------------------------------------------------------------------
    // GenerateAsync — returns text and selectedProfileId
    // -------------------------------------------------------------------------

    [Fact]
    public async Task GenerateAsync_ReturnsCoverLetterText()
    {
        var userId = Guid.NewGuid();
        await using var db = CreateDb();
        var profile = MakeProfile(userId, "Backend Engineer", "8 years backend.");
        db.Profiles.Add(profile);
        await db.SaveChangesAsync();

        var llm = new Mock<ILlmService>();
        llm.Setup(s => s.GenerateCoverLetterAsync(It.IsAny<LlmCoverLetterRequest>()))
           .ReturnsAsync(new LlmCoverLetterResponse("Dear Hiring Manager...", profile.Id));

        var svc = new CoverLetterService(db, llm.Object);
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
        await using var db = CreateDb();

        var llm = new Mock<ILlmService>();
        var svc = new CoverLetterService(db, llm.Object);

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
        await using var db = CreateDb();
        var otherProfile = MakeProfile(otherUserId, "Frontend Dev", "React developer.");
        db.Profiles.Add(otherProfile);
        await db.SaveChangesAsync();

        var llm = new Mock<ILlmService>();
        var svc = new CoverLetterService(db, llm.Object);

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
        await using var db = CreateDb();
        var p1 = MakeProfile(userId, "Backend Engineer", "Python/Go expert.");
        var p2 = MakeProfile(userId, "Frontend Developer", "React specialist.");
        db.Profiles.AddRange(p1, p2);
        await db.SaveChangesAsync();

        LlmCoverLetterRequest? captured = null;
        var llm = new Mock<ILlmService>();
        llm.Setup(s => s.GenerateCoverLetterAsync(It.IsAny<LlmCoverLetterRequest>()))
           .Callback<LlmCoverLetterRequest>(r => captured = r)
           .ReturnsAsync(new LlmCoverLetterResponse("Cover letter text.", p1.Id));

        var svc = new CoverLetterService(db, llm.Object);
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

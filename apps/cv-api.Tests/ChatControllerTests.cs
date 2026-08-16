using System.Security.Claims;
using CvApi.Domain.Entities;
using CvApi.Features.Billing;
using CvApi.Features.Chat;
using CvApi.Features.Usage;
using CvApi.Infrastructure.ExternalServices.Llm;
using CvApi.Infrastructure.Persistence;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace CvApi.Tests;

// US-AI-13 — in edit mode the agent may read the user's OTHER saved profiles, but
// the profile open in the editor must be excluded from that list. Otherwise it
// shows up in list_profiles as a source to populate *from itself* (the confusing
// symptom seen in Langfuse trace 99d91a29). The editor sends its ProfileId so the
// controller can filter the open profile out.
public class ChatControllerTests
{
    private sealed class CapturingLlmService : ILlmService
    {
        public LlmChatRequest? LastChatRequest { get; private set; }

        public Task<LlmChatResponse> ChatAsync(LlmChatRequest request)
        {
            LastChatRequest = request;
            return Task.FromResult(new LlmChatResponse("ok", null, LlmTokenUsage.Empty));
        }

        // Unused by these tests.
        public Task<LlmGenerateResponse> GenerateAsync(LlmGenerateRequest r) => throw new NotImplementedException();
        public Task<LlmExtractResponse> ExtractAsync(LlmExtractRequest r) => throw new NotImplementedException();
        public Task<LlmUserChatResponse> UserChatAsync(LlmUserChatRequest r) => throw new NotImplementedException();
        public Task<LlmJobChatResponse> JobChatAsync(LlmJobChatRequest r) => throw new NotImplementedException();
        public Task<LlmCoverLetterResponse> GenerateCoverLetterAsync(LlmCoverLetterRequest r) => throw new NotImplementedException();
        public Task<LlmSelectBestProfileResponse> SelectBestProfileAsync(LlmSelectBestProfileRequest r) => throw new NotImplementedException();
    }

    private static InMemoryStore CreateDb() => new();

    private static UsageService Usage(InMemoryStore db) =>
        new(db, db, db, db,
            Options.Create(new LlmPricingOptions
            {
                Models = new() { ["default"] = new LlmPricingModel { PromptCostPer1M = 3m, CompletionCostPer1M = 15m } },
            }),
            Options.Create(new UsageLimitOptions { MaxCostUsdPerUser = 100m }),
            Options.Create(new BillingOptions()));

    private static ChatController Controller(InMemoryStore db, ILlmService llm, Guid userId) =>
        new(db, db, llm, Usage(db))
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity(
                        [new Claim(ClaimTypes.NameIdentifier, userId.ToString())], "test")),
                },
            },
        };

    private static Profile Prof(Guid userId, string name) =>
        new() { Id = Guid.NewGuid(), UserId = userId, Name = name, Document = ProfileDocument.Empty() };

    [Fact]
    public async Task EditMode_ExcludesTheOpenProfileFromCrossProfileReads()
    {
        var db = CreateDb();
        var userId = Guid.NewGuid();
        var open = Prof(userId, "Junior Machine Learning Developer");
        var other = Prof(userId, "Senior Software Engineer");
        db.Profiles.AddRange(open, other);
        await db.SaveChangesAsync();

        var llm = new CapturingLlmService();

        await Controller(db, llm, userId).Chat(new UserChatRequest(
            Message: "populate this profile based on my other one",
            Document: ProfileDocument.Empty(),
            ProfileId: open.Id.ToString()));

        var others = llm.LastChatRequest!.OtherProfiles!;
        Assert.DoesNotContain(others, p => p.Id == open.Id.ToString());
        Assert.Contains(others, p => p.Id == other.Id.ToString());
    }

    [Fact]
    public async Task EditMode_WithoutProfileId_PassesAllProfiles_BackwardCompat()
    {
        var db = CreateDb();
        var userId = Guid.NewGuid();
        db.Profiles.AddRange(Prof(userId, "A"), Prof(userId, "B"));
        await db.SaveChangesAsync();

        var llm = new CapturingLlmService();

        // Older clients / an unsaved doc send no ProfileId — keep the full set.
        await Controller(db, llm, userId).Chat(new UserChatRequest(
            Message: "help me edit this",
            Document: ProfileDocument.Empty()));

        Assert.Equal(2, llm.LastChatRequest!.OtherProfiles!.Count);
    }

    [Fact]
    public async Task EditMode_DoesNotLeakAnotherUsersProfiles()
    {
        var db = CreateDb();
        var userId = Guid.NewGuid();
        var mine = Prof(userId, "Mine");
        var theirs = Prof(Guid.NewGuid(), "Someone else's");
        db.Profiles.AddRange(mine, theirs);
        await db.SaveChangesAsync();

        var llm = new CapturingLlmService();

        await Controller(db, llm, userId).Chat(new UserChatRequest(
            Message: "edit",
            Document: ProfileDocument.Empty(),
            ProfileId: mine.Id.ToString()));

        // Only the current user's profiles are eligible, and the open one is excluded,
        // so with a single owned (open) profile the cross-profile list is empty.
        Assert.Empty(llm.LastChatRequest!.OtherProfiles!);
    }
}

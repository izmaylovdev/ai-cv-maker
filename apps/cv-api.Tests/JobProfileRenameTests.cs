using System.Net;
using System.Text;
using System.Text.Json;
using CvApi.Domain.Entities;
using CvApi.Infrastructure.Persistence;
using Microsoft.Extensions.DependencyInjection;

namespace CvApi.Tests;

// US-PROF-7 / F-PROF-7.4–7.6 — PATCH /api/job-profiles/{id} renames a profile
// via a dedicated name-only call. Full HTTP stack: routing, auth, validation,
// persistence; the profile's document must never be touched by a rename.
// Reuses ExtractionApiFactory (JWT auth + in-memory DB + mocked LLM).
public class JobProfileRenameTests(ExtractionApiFactory factory) : IClassFixture<ExtractionApiFactory>
{
    // -------------------------------------------------------------------------
    // Happy path
    // -------------------------------------------------------------------------

    [Fact]
    public async Task Rename_ValidName_Returns200WithListItemShape()
    {
        var (userId, profileId) = await factory.SeedProfileAsync();
        var client = factory.CreateAuthenticatedClient(userId);

        var response = await client.PatchAsync(
            $"/api/job-profiles/{profileId}", JsonBody(new { name = "Staff Engineer Roles" }));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;
        Assert.Equal(profileId, Guid.Parse(json.GetProperty("id").GetString()!));
        Assert.Equal("Staff Engineer Roles", json.GetProperty("name").GetString());
        // Same DTO shape as list/create: { id, name, fullName, title }.
        Assert.True(json.TryGetProperty("fullName", out _));
        Assert.True(json.TryGetProperty("title", out _));
    }

    [Fact]
    public async Task Rename_NameWithSurroundingWhitespace_IsTrimmed()
    {
        var (userId, profileId) = await factory.SeedProfileAsync();
        var client = factory.CreateAuthenticatedClient(userId);

        var response = await client.PatchAsync(
            $"/api/job-profiles/{profileId}", JsonBody(new { name = "  Backend Roles  " }));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;
        Assert.Equal("Backend Roles", json.GetProperty("name").GetString());
    }

    [Fact]
    public async Task Rename_NewName_PersistsAndIsReturnedByGet()
    {
        var (userId, profileId) = await factory.SeedProfileAsync();
        var client = factory.CreateAuthenticatedClient(userId);

        var patch = await client.PatchAsync(
            $"/api/job-profiles/{profileId}", JsonBody(new { name = "Persisted Name" }));
        Assert.Equal(HttpStatusCode.OK, patch.StatusCode);

        var get = await client.GetAsync($"/api/job-profiles/{profileId}");
        Assert.Equal(HttpStatusCode.OK, get.StatusCode);
        var json = JsonDocument.Parse(await get.Content.ReadAsStringAsync()).RootElement;
        Assert.Equal("Persisted Name", json.GetProperty("name").GetString());
    }

    // -------------------------------------------------------------------------
    // Rename never touches the document (F-PROF-7.4 / US-PROF-7)
    // -------------------------------------------------------------------------

    [Fact]
    public async Task Rename_LeavesDocumentContentUnchanged()
    {
        var (userId, profileId) = await SeedProfileWithDocumentAsync();
        var client = factory.CreateAuthenticatedClient(userId);

        var patch = await client.PatchAsync(
            $"/api/job-profiles/{profileId}", JsonBody(new { name = "Renamed Only" }));
        Assert.Equal(HttpStatusCode.OK, patch.StatusCode);

        var get = await client.GetAsync($"/api/job-profiles/{profileId}");
        var json = JsonDocument.Parse(await get.Content.ReadAsStringAsync()).RootElement;

        Assert.Equal("Renamed Only", json.GetProperty("name").GetString());
        var header = json.GetProperty("document").GetProperty("header");
        Assert.Equal("Grace Hopper", header.GetProperty("fullName").GetString());
        var children = json.GetProperty("document").GetProperty("body").GetProperty("children");
        Assert.Equal(2, children.GetArrayLength());
        Assert.Equal("title",     children[0].GetProperty("type").GetString());
        Assert.Equal("Summary",   children[0].GetProperty("attrs").GetProperty("text").GetString());
        Assert.Equal("paragraph", children[1].GetProperty("type").GetString());
    }

    // -------------------------------------------------------------------------
    // Validation — 400 on blank / whitespace-only / over-long names (F-PROF-7.5)
    // -------------------------------------------------------------------------

    [Fact]
    public async Task Rename_EmptyName_Returns400()
    {
        var (userId, profileId) = await factory.SeedProfileAsync();
        var client = factory.CreateAuthenticatedClient(userId);

        var response = await client.PatchAsync(
            $"/api/job-profiles/{profileId}", JsonBody(new { name = "" }));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Rename_WhitespaceOnlyName_Returns400()
    {
        var (userId, profileId) = await factory.SeedProfileAsync();
        var client = factory.CreateAuthenticatedClient(userId);

        var response = await client.PatchAsync(
            $"/api/job-profiles/{profileId}", JsonBody(new { name = "   " }));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Rename_NameOver100CharsAfterTrim_Returns400()
    {
        var (userId, profileId) = await factory.SeedProfileAsync();
        var client = factory.CreateAuthenticatedClient(userId);

        var response = await client.PatchAsync(
            $"/api/job-profiles/{profileId}", JsonBody(new { name = new string('a', 101) }));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // -------------------------------------------------------------------------
    // Access control — 404 on foreign/unknown profiles, 401 without JWT
    // -------------------------------------------------------------------------

    [Fact]
    public async Task Rename_ProfileBelongsToAnotherUser_Returns404()
    {
        var (_, profileId) = await factory.SeedProfileAsync();   // owned by someone else
        var client = factory.CreateAuthenticatedClient(Guid.NewGuid());

        var response = await client.PatchAsync(
            $"/api/job-profiles/{profileId}", JsonBody(new { name = "Hijacked" }));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Rename_UnknownProfile_Returns404()
    {
        var client = factory.CreateAuthenticatedClient(Guid.NewGuid());

        var response = await client.PatchAsync(
            $"/api/job-profiles/{Guid.NewGuid()}", JsonBody(new { name = "Whatever" }));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Rename_Unauthenticated_Returns401()
    {
        var (_, profileId) = await factory.SeedProfileAsync();
        var client = factory.CreateClient();   // no JWT

        var response = await client.PatchAsync(
            $"/api/job-profiles/{profileId}", JsonBody(new { name = "New Name" }));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private static StringContent JsonBody(object payload) =>
        new(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");

    /// <summary>Seeds a profile with a non-empty ADR-0014 document.</summary>
    private async Task<(Guid UserId, Guid ProfileId)> SeedProfileWithDocumentAsync()
    {
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var userId = Guid.NewGuid();
        var profile = new Profile
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            Name = "Original Name",
            Document = new ProfileDocument
            {
                Header = new ProfileHeader { FullName = "Grace Hopper", Title = "Rear Admiral" },
                Body = new BlockNode
                {
                    Type = "root", Id = "root-1",
                    Children =
                    [
                        new BlockNode { Type = "title", Id = "t1", Attrs = new() { ["text"] = "Summary" } },
                        new BlockNode
                        {
                            Type = "paragraph", Id = "p1",
                            Children = [new BlockNode { Type = "text", Id = "x1", Attrs = new() { ["text"] = "Invented the compiler." } }],
                        },
                    ],
                },
            },
        };
        db.Profiles.Add(profile);
        await db.SaveChangesAsync();
        return (userId, profile.Id);
    }
}

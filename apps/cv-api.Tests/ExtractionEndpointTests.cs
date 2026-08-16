using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Headers;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using CvApi.Domain.Entities;
using CvApi.Infrastructure.ExternalServices.Llm;
using CvApi.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Tokens;
using Moq;

namespace CvApi.Tests;

// End-to-end tests for POST /api/job-profiles/{id}/extract — file upload through
// the full HTTP stack: routing, auth, multipart parsing, text extraction, mocked
// LLM call, server-side ADR-0013→ADR-0014 migration, and JSON serialisation.
public class ExtractionEndpointTests(ExtractionApiFactory factory) : IClassFixture<ExtractionApiFactory>
{
    // -------------------------------------------------------------------------
    // Happy path: text file → LLM called with content → ADR-0014 doc returned
    // -------------------------------------------------------------------------

    [Fact]
    public async Task Extract_TextFile_CallsLlmWithFileTextAndReturns200()
    {
        var (userId, profileId) = await factory.SeedProfileAsync();
        var client = factory.CreateAuthenticatedClient(userId);

        string? capturedText = null;
        factory.LlmMock
            .Setup(s => s.ExtractAsync(It.IsAny<LlmExtractRequest>()))
            .Callback<LlmExtractRequest>(r => capturedText = r.CvText)
            .ReturnsAsync(new LlmExtractResponse(
                Document: Adt0014Doc("John Doe", "Software Engineer"),
                Usage: LlmTokenUsage.Empty));

        var response = await client.PostAsync(
            $"/api/job-profiles/{profileId}/extract",
            BuildFileContent("John Doe\nSoftware Engineer\nPython, Go", "cv.txt", "text/plain"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("John Doe", capturedText ?? "");
    }

    [Fact]
    public async Task Extract_TextFile_ResponseContainsExtractedDocument()
    {
        var (userId, profileId) = await factory.SeedProfileAsync();
        var client = factory.CreateAuthenticatedClient(userId);

        factory.LlmMock
            .Setup(s => s.ExtractAsync(It.IsAny<LlmExtractRequest>()))
            .ReturnsAsync(new LlmExtractResponse(
                Document: Adt0014Doc("Ada Lovelace", "Mathematician"),
                Usage: LlmTokenUsage.Empty));

        var response = await client.PostAsync(
            $"/api/job-profiles/{profileId}/extract",
            BuildFileContent("Ada Lovelace", "cv.txt", "text/plain"));

        var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var header = json.RootElement.GetProperty("document").GetProperty("header");
        Assert.Equal("Ada Lovelace", header.GetProperty("fullName").GetString());
        Assert.Equal("Mathematician",  header.GetProperty("title").GetString());
    }

    // -------------------------------------------------------------------------
    // Migration: LLM returns legacy section nodes → server migrates to ADR-0014
    // -------------------------------------------------------------------------

    [Fact]
    public async Task Extract_LlmReturnsLegacySectionNodes_ResponseHasMigratedTitlePlusChildren()
    {
        var (userId, profileId) = await factory.SeedProfileAsync();
        var client = factory.CreateAuthenticatedClient(userId);

        // LLM emits the retired ADR-0013 section format.
        var legacyDoc = LegacySectionDoc("Alan Turing");
        factory.LlmMock
            .Setup(s => s.ExtractAsync(It.IsAny<LlmExtractRequest>()))
            .ReturnsAsync(new LlmExtractResponse(legacyDoc, LlmTokenUsage.Empty));

        var response = await client.PostAsync(
            $"/api/job-profiles/{profileId}/extract",
            BuildFileContent("Alan Turing", "cv.txt", "text/plain"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var children = json.RootElement
            .GetProperty("document")
            .GetProperty("body")
            .GetProperty("children");

        // One legacy section → flat [title, paragraph]; no `section` node survives.
        Assert.Equal(2, children.GetArrayLength());
        Assert.Equal("title",     children[0].GetProperty("type").GetString());
        Assert.Equal("Summary",   children[0].GetProperty("attrs").GetProperty("text").GetString());
        Assert.Equal("paragraph", children[1].GetProperty("type").GetString());
    }

    [Fact]
    public async Task Extract_LlmReturnsMultipleLegacySections_AllMigrated()
    {
        var (userId, profileId) = await factory.SeedProfileAsync();
        var client = factory.CreateAuthenticatedClient(userId);

        var legacyDoc = TwoSectionDoc();
        factory.LlmMock
            .Setup(s => s.ExtractAsync(It.IsAny<LlmExtractRequest>()))
            .ReturnsAsync(new LlmExtractResponse(legacyDoc, LlmTokenUsage.Empty));

        var response = await client.PostAsync(
            $"/api/job-profiles/{profileId}/extract",
            BuildFileContent("CV text", "cv.txt", "text/plain"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var children = JsonDocument.Parse(await response.Content.ReadAsStringAsync())
            .RootElement
            .GetProperty("document").GetProperty("body").GetProperty("children");

        // Two sections → [title, paragraph, title, chips] — four flat children.
        Assert.Equal(4, children.GetArrayLength());
        Assert.Equal("title",     children[0].GetProperty("type").GetString());
        Assert.Equal("Summary",   children[0].GetProperty("attrs").GetProperty("text").GetString());
        Assert.Equal("paragraph", children[1].GetProperty("type").GetString());
        Assert.Equal("title",     children[2].GetProperty("type").GetString());
        Assert.Equal("Skills",    children[2].GetProperty("attrs").GetProperty("text").GetString());
        Assert.Equal("chips",     children[3].GetProperty("type").GetString());
    }

    // -------------------------------------------------------------------------
    // Error cases
    // -------------------------------------------------------------------------

    [Fact]
    public async Task Extract_EmptyFile_Returns400()
    {
        var (userId, profileId) = await factory.SeedProfileAsync();
        var client = factory.CreateAuthenticatedClient(userId);

        var content = new MultipartFormDataContent();
        var empty = new ByteArrayContent([]);
        empty.Headers.ContentType = new MediaTypeHeaderValue("text/plain");
        content.Add(empty, "file", "empty.txt");

        var response = await client.PostAsync($"/api/job-profiles/{profileId}/extract", content);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Extract_ProfileBelongsToAnotherUser_Returns404()
    {
        var (_, profileId) = await factory.SeedProfileAsync();  // owned by someone else
        var intruder = Guid.NewGuid();
        var client = factory.CreateAuthenticatedClient(intruder);

        factory.LlmMock
            .Setup(s => s.ExtractAsync(It.IsAny<LlmExtractRequest>()))
            .ReturnsAsync(new LlmExtractResponse(Adt0014Doc("X", "Y"), LlmTokenUsage.Empty));

        var response = await client.PostAsync(
            $"/api/job-profiles/{profileId}/extract",
            BuildFileContent("some text", "cv.txt", "text/plain"));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Extract_Unauthenticated_Returns401()
    {
        var (_, profileId) = await factory.SeedProfileAsync();
        var client = factory.CreateClient();   // no JWT

        var response = await client.PostAsync(
            $"/api/job-profiles/{profileId}/extract",
            BuildFileContent("some text", "cv.txt", "text/plain"));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private static MultipartFormDataContent BuildFileContent(string text, string fileName, string mediaType)
    {
        var content = new MultipartFormDataContent();
        var fileBytes = new ByteArrayContent(Encoding.UTF8.GetBytes(text));
        fileBytes.Headers.ContentType = new MediaTypeHeaderValue(mediaType);
        content.Add(fileBytes, "file", fileName);
        return content;
    }

    private static BlockNode Leaf(string type, string key, string value) =>
        new() { Type = type, Id = Guid.NewGuid().ToString("n"), Attrs = new() { [key] = value } };

    private static ProfileDocument Adt0014Doc(string fullName, string title) => new()
    {
        Header = new ProfileHeader { FullName = fullName, Title = title },
        Body = new BlockNode
        {
            Type = "root", Id = Guid.NewGuid().ToString("n"),
            Children =
            [
                Leaf("title", "text", "Summary"),
                new BlockNode
                {
                    Type = "paragraph", Id = Guid.NewGuid().ToString("n"),
                    Children = [Leaf("text", "text", $"Overview of {fullName}.")],
                },
            ],
        },
    };

    private static ProfileDocument LegacySectionDoc(string fullName) => new()
    {
        Header = new ProfileHeader { FullName = fullName },
        Body = new BlockNode
        {
            Type = "root", Id = Guid.NewGuid().ToString("n"),
            Children =
            [
                new BlockNode
                {
                    Type = "section", Id = Guid.NewGuid().ToString("n"),
                    Attrs = new() { ["heading"] = "Summary" },
                    Children =
                    [
                        new BlockNode
                        {
                            Type = "paragraph", Id = Guid.NewGuid().ToString("n"),
                            Children = [Leaf("text", "text", $"Bio of {fullName}.")],
                        },
                    ],
                },
            ],
        },
    };

    private static ProfileDocument TwoSectionDoc() => new()
    {
        Header = new ProfileHeader { FullName = "Test User" },
        Body = new BlockNode
        {
            Type = "root", Id = Guid.NewGuid().ToString("n"),
            Children =
            [
                new BlockNode
                {
                    Type = "section", Id = Guid.NewGuid().ToString("n"),
                    Attrs = new() { ["heading"] = "Summary" },
                    Children =
                    [
                        new BlockNode
                        {
                            Type = "paragraph", Id = Guid.NewGuid().ToString("n"),
                            Children = [Leaf("text", "text", "Overview.")],
                        },
                    ],
                },
                new BlockNode
                {
                    Type = "section", Id = Guid.NewGuid().ToString("n"),
                    Attrs = new() { ["heading"] = "Skills" },
                    Children =
                    [
                        new BlockNode
                        {
                            Type = "chips", Id = Guid.NewGuid().ToString("n"),
                            Children = [Leaf("chip", "text", "Go")],
                        },
                    ],
                },
            ],
        },
    };
}

// ---------------------------------------------------------------------------
// Shared factory — one instance per test class (IClassFixture).
// ---------------------------------------------------------------------------

public class ExtractionApiFactory : WebApplicationFactory<Program>
{
    /// <summary>Shared fake persistence for this factory (ADR-0021 seam).</summary>
    public InMemoryStore Store { get; } = new();

    public Mock<ILlmService> LlmMock { get; } = new(MockBehavior.Strict);

    private const string JwtSecret   = "test-secret-key-for-hmacsha256-exactly-32ch";
    private const string JwtIssuer   = "test-issuer";
    private const string JwtAudience = "test-audience";

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");

        builder.ConfigureServices(services =>
        {
            // Program.cs reads JwtSettings:Secret during service registration, before
            // ConfigureAppConfiguration runs. Patch the already-registered options so
            // test-generated tokens are accepted.
            services.PostConfigure<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme, opts =>
            {
                opts.TokenValidationParameters = new TokenValidationParameters
                {
                    ValidateIssuerSigningKey = true,
                    IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(JwtSecret)),
                    ValidateIssuer = true,
                    ValidIssuer = JwtIssuer,
                    ValidateAudience = true,
                    ValidAudience = JwtAudience,
                    ClockSkew = TimeSpan.Zero,
                };
            });

            // EF Core 9 registers both a built DbContextOptions<T> descriptor AND one
            // IDbContextOptionsConfiguration<T> descriptor per AddDbContext call (the
            // latter is used to lazily build the options). Remove both so that the
            // Npgsql provider doesn't linger alongside InMemory.
            var efConfigType = services
                .Select(d => d.ServiceType)
                .FirstOrDefault(t => t.IsGenericType
                    && t.Name.StartsWith("IDbContextOptionsConfiguration")
                    && t.GenericTypeArguments.FirstOrDefault() == typeof(AppDbContext));

            if (efConfigType is not null)
                foreach (var d in services.Where(d => d.ServiceType == efConfigType).ToList())
                    services.Remove(d);

            foreach (var d in services
                .Where(d => d.ServiceType == typeof(DbContextOptions<AppDbContext>))
                .ToList())
                services.Remove(d);

            services.UseInMemoryStore(Store);

            // Replace the real LlmService with mock (remove all descriptors to
            // avoid ambiguity from gRPC client registration).
            foreach (var d in services.Where(d => d.ServiceType == typeof(ILlmService)).ToList())
                services.Remove(d);
            services.AddScoped<ILlmService>(_ => LlmMock.Object);
        });
    }

    /// <summary>Seeds a profile owned by a fresh user and returns both IDs.</summary>
    public async Task<(Guid UserId, Guid ProfileId)> SeedProfileAsync()
    {
        using var scope = Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<InMemoryStore>();

        var userId = Guid.NewGuid();
        var profile = new Profile
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            Name = "Test Profile",
            Document = ProfileDocument.Empty(),
        };
        db.Profiles.Add(profile);
        await db.SaveChangesAsync();
        return (userId, profile.Id);
    }

    public HttpClient CreateAuthenticatedClient(Guid userId)
    {
        var client = CreateClient();
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", GenerateJwt(userId));
        return client;
    }

    private string GenerateJwt(Guid userId)
    {
        var key   = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(JwtSecret));
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);
        var token = new JwtSecurityToken(
            issuer:             JwtIssuer,
            audience:           JwtAudience,
            claims:             [new Claim(ClaimTypes.NameIdentifier, userId.ToString())],
            expires:            DateTime.UtcNow.AddHours(1),
            signingCredentials: creds);
        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}

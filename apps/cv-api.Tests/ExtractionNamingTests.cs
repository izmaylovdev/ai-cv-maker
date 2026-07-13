using System.Net;
using System.Net.Http.Headers;
using System.Reflection;
using System.Text;
using System.Text.Json;
using CvApi.Domain.Entities;
using CvApi.Infrastructure.ExternalServices.Llm;
using Moq;

namespace CvApi.Tests;

// US-PROF-8 / F-PROF-8.1–8.3 — POST /api/job-profiles/{id}/extract returns the
// LLM-suggested profile name in its `name` field: trimmed, capped at 100 chars,
// falling back to the profile's current name when the LLM produced none.
//
// LlmExtractResponse does not yet have a ProfileName member (US-PROF-8 red
// phase), so the mocked response is built reflectively: the helper fails the
// test with a clear message until the record gains the parameter, and then
// exercises the real mapping.
public class ExtractionNamingTests(ExtractionApiFactory factory) : IClassFixture<ExtractionApiFactory>
{
    [Fact]
    public async Task Extract_LlmSuggestsName_ResponseNameIsSuggestedName()
    {
        var (userId, profileId) = await factory.SeedProfileAsync();   // profile named "Test Profile"
        var client = factory.CreateAuthenticatedClient(userId);

        factory.LlmMock
            .Setup(s => s.ExtractAsync(It.IsAny<LlmExtractRequest>()))
            .ReturnsAsync(LlmResponseWithName(Doc("Alex Smith", "Staff Platform Engineer"), "Staff Platform Engineer"));

        var response = await client.PostAsync(
            $"/api/job-profiles/{profileId}/extract",
            FileContent("Alex Smith\nStaff Platform Engineer"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;
        Assert.Equal("Staff Platform Engineer", json.GetProperty("name").GetString());
    }

    [Fact]
    public async Task Extract_LlmNameHasSurroundingWhitespace_ResponseNameIsTrimmed()
    {
        var (userId, profileId) = await factory.SeedProfileAsync();
        var client = factory.CreateAuthenticatedClient(userId);

        factory.LlmMock
            .Setup(s => s.ExtractAsync(It.IsAny<LlmExtractRequest>()))
            .ReturnsAsync(LlmResponseWithName(Doc("Alex Smith", "Data Engineer"), "  Data Engineer  "));

        var response = await client.PostAsync(
            $"/api/job-profiles/{profileId}/extract", FileContent("Alex Smith"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;
        Assert.Equal("Data Engineer", json.GetProperty("name").GetString());
    }

    [Fact]
    public async Task Extract_LlmNameOver100Chars_ResponseNameCappedAt100()
    {
        var (userId, profileId) = await factory.SeedProfileAsync();
        var client = factory.CreateAuthenticatedClient(userId);

        var longName = new string('n', 150);
        factory.LlmMock
            .Setup(s => s.ExtractAsync(It.IsAny<LlmExtractRequest>()))
            .ReturnsAsync(LlmResponseWithName(Doc("Alex Smith", "Engineer"), longName));

        var response = await client.PostAsync(
            $"/api/job-profiles/{profileId}/extract", FileContent("Alex Smith"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;
        var name = json.GetProperty("name").GetString();
        Assert.Equal(100, name!.Length);
        Assert.Equal(longName[..100], name);
    }

    [Fact]
    public async Task Extract_LlmNameBlank_ResponseNameIsCurrentProfileName()
    {
        // F-PROF-8.3 fallback — no usable LLM name keeps the existing behaviour
        // of echoing the profile's current name ("Test Profile" from the seed).
        var (userId, profileId) = await factory.SeedProfileAsync();
        var client = factory.CreateAuthenticatedClient(userId);

        factory.LlmMock
            .Setup(s => s.ExtractAsync(It.IsAny<LlmExtractRequest>()))
            .ReturnsAsync(LlmResponseWithName(Doc("Alex Smith", "Engineer"), "   "));

        var response = await client.PostAsync(
            $"/api/job-profiles/{profileId}/extract", FileContent("Alex Smith"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;
        Assert.Equal("Test Profile", json.GetProperty("name").GetString());
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    /// <summary>
    /// Builds an LlmExtractResponse carrying an LLM-suggested profile name.
    /// Constructed reflectively so this file compiles before US-PROF-8 adds the
    /// ProfileName parameter; until then every caller fails red with a clear
    /// "not implemented" message.
    /// </summary>
    private static LlmExtractResponse LlmResponseWithName(ProfileDocument doc, string profileName)
    {
        var ctor = typeof(LlmExtractResponse).GetConstructors()
            .FirstOrDefault(c => c.GetParameters()
                .Any(p => string.Equals(p.Name, "ProfileName", StringComparison.OrdinalIgnoreCase)));
        Assert.True(ctor is not null,
            "LlmExtractResponse has no ProfileName constructor parameter — US-PROF-8 (F-PROF-8.1) not implemented yet.");

        var args = ctor!.GetParameters().Select(p => p.Name switch
        {
            "Document"    => (object?)doc,
            "Usage"       => LlmTokenUsage.Empty,
            "ProfileName" => profileName,
            _             => p.HasDefaultValue ? p.DefaultValue : null,
        }).ToArray();
        return (LlmExtractResponse)ctor.Invoke(args);
    }

    private static MultipartFormDataContent FileContent(string text)
    {
        var content = new MultipartFormDataContent();
        var fileBytes = new ByteArrayContent(Encoding.UTF8.GetBytes(text));
        fileBytes.Headers.ContentType = new MediaTypeHeaderValue("text/plain");
        content.Add(fileBytes, "file", "cv.txt");
        return content;
    }

    private static ProfileDocument Doc(string fullName, string title) => new()
    {
        Header = new ProfileHeader { FullName = fullName, Title = title },
        Body = new BlockNode
        {
            Type = "root", Id = Guid.NewGuid().ToString("n"),
            Children =
            [
                new BlockNode { Type = "title", Id = Guid.NewGuid().ToString("n"), Attrs = new() { ["text"] = "Summary" } },
                new BlockNode
                {
                    Type = "paragraph", Id = Guid.NewGuid().ToString("n"),
                    Children = [new BlockNode { Type = "text", Id = Guid.NewGuid().ToString("n"), Attrs = new() { ["text"] = "Overview." } }],
                },
            ],
        },
    };
}

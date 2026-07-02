using System.Net;
using System.Net.Http.Json;

namespace CvApi.Tests;

// End-to-end tests for input validation on POST /api/auth/register: a weak or
// malformed credential must be rejected before an account is created. Reuses the
// extraction factory only for its in-memory DB + host wiring; no LLM is involved.
public class RegisterValidationTests(ExtractionApiFactory factory) : IClassFixture<ExtractionApiFactory>
{
    private record RegisterBody(string email, string password);

    [Fact]
    public async Task Register_ShortPassword_Returns400()
    {
        var client = factory.CreateClient();
        var res = await client.PostAsJsonAsync("/api/auth/register",
            new RegisterBody("valid@example.com", "short"));
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Register_MalformedEmail_Returns400()
    {
        var client = factory.CreateClient();
        var res = await client.PostAsJsonAsync("/api/auth/register",
            new RegisterBody("not-an-email", "longenoughpassword"));
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Register_ValidCredentials_Returns200()
    {
        var client = factory.CreateClient();
        var res = await client.PostAsJsonAsync("/api/auth/register",
            new RegisterBody($"new-{System.Guid.NewGuid():N}@example.com", "longenoughpassword"));
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
    }
}

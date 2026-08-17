using System.IdentityModel.Tokens.Jwt;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using CvApi.Domain.Entities;
using CvApi.Infrastructure.ExternalServices.Llm;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Tokens;
using Moq;

namespace CvApi.Tests;

// US-BILL-1 — top-up payments through the full HTTP stack (WebApplicationFactory,
// InMemory EF, fake payment providers enabled via Billing:Payments:UseFakeProviders).
// All tests go through /api/billing* endpoints with JSON, mirroring the spec in
// doc/web-client/specs/billing.md §1. No spec-only C# types are referenced so the
// project compiles before the implementation exists; tests fail at runtime (404s).
public class TopUpTests(TopUpApiFactory factory) : IClassFixture<TopUpApiFactory>
{
    // -------------------------------------------------------------------------
    // Auth — all top-up and country endpoints require a JWT
    // -------------------------------------------------------------------------

    [Fact]
    public async Task TopUp_Unauthenticated_Returns401()
    {
        var client = factory.CreateClient(); // no JWT
        var response = await client.PostAsJsonAsync("/api/billing/top-up", new { amountUsd = 10 });
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task PutCountry_Unauthenticated_Returns401()
    {
        var client = factory.CreateClient();
        var response = await client.PutAsJsonAsync("/api/billing/country", new { country = "UA" });
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task TopUpHistory_Unauthenticated_Returns401()
    {
        var client = factory.CreateClient();
        var response = await client.GetAsync("/api/billing/top-ups");
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // -------------------------------------------------------------------------
    // PUT /api/billing/country — validation and persistence
    // -------------------------------------------------------------------------

    [Fact]
    public async Task PutCountry_ValidIsoAlpha2_Returns204_AndShowsUpInBillingSummary()
    {
        var userId = await factory.SeedUserAsync();
        var client = factory.CreateAuthenticatedClient(userId);

        var put = await client.PutAsJsonAsync("/api/billing/country", new { country = "UA" });
        Assert.Equal(HttpStatusCode.NoContent, put.StatusCode);

        // GET /api/billing now includes the stored country.
        var summary = await GetJsonAsync(client, "/api/billing");
        Assert.Equal("UA", summary.RootElement.GetProperty("country").GetString());
    }

    [Fact]
    public async Task BillingSummary_CountryIsNull_WhenNeverAsked()
    {
        var userId = await factory.SeedUserAsync();
        var client = factory.CreateAuthenticatedClient(userId);

        var summary = await GetJsonAsync(client, "/api/billing");
        Assert.Equal(JsonValueKind.Null, summary.RootElement.GetProperty("country").ValueKind);
    }

    [Theory]
    [InlineData("usa")] // three letters
    [InlineData("u1")]  // digit
    [InlineData("")]    // empty
    [InlineData("ua")]  // lowercase — spec requires uppercase ISO alpha-2
    public async Task PutCountry_Invalid_Returns400(string country)
    {
        var userId = await factory.SeedUserAsync();
        var client = factory.CreateAuthenticatedClient(userId);

        var response = await client.PutAsJsonAsync("/api/billing/country", new { country });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // -------------------------------------------------------------------------
    // POST /api/billing/top-up — validation and channel routing
    // -------------------------------------------------------------------------

    [Fact]
    public async Task TopUp_WithoutStoredCountry_Returns409()
    {
        var userId = await factory.SeedUserAsync(); // country never set
        var client = factory.CreateAuthenticatedClient(userId);

        var response = await client.PostAsJsonAsync("/api/billing/top-up", new { amountUsd = 10 });
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    [Theory]
    [InlineData(7)]
    [InlineData(0)]
    [InlineData(-5)]
    [InlineData(1000)]
    public async Task TopUp_AmountNotInFixedSet_Returns400(int amountUsd)
    {
        var userId = await factory.SeedUserAsync();
        var client = factory.CreateAuthenticatedClient(userId);
        await SetCountryAsync(client, "DE");

        var response = await client.PostAsJsonAsync("/api/billing/top-up", new { amountUsd });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task TopUp_CountryUkraine_RoutesToMonobankChannel()
    {
        var userId = await factory.SeedUserAsync();
        var client = factory.CreateAuthenticatedClient(userId);
        await SetCountryAsync(client, "UA");

        var response = await client.PostAsJsonAsync("/api/billing/top-up", new { amountUsd = 10 });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Contains("monobank", json.RootElement.GetProperty("channel").GetString());
        Assert.False(string.IsNullOrEmpty(json.RootElement.GetProperty("paymentId").GetString()));
        Assert.False(string.IsNullOrEmpty(json.RootElement.GetProperty("redirectUrl").GetString()));

        // The channel is also recorded on the history entry.
        var history = await GetJsonAsync(client, "/api/billing/top-ups");
        Assert.Contains("monobank", history.RootElement[0].GetProperty("channel").GetString());
    }

    [Fact]
    public async Task TopUp_AnyOtherCountry_RoutesToStripeChannel()
    {
        var userId = await factory.SeedUserAsync();
        var client = factory.CreateAuthenticatedClient(userId);
        await SetCountryAsync(client, "DE");

        var response = await client.PostAsJsonAsync("/api/billing/top-up", new { amountUsd = 5 });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Contains("stripe", json.RootElement.GetProperty("channel").GetString());

        var history = await GetJsonAsync(client, "/api/billing/top-ups");
        Assert.Contains("stripe", history.RootElement[0].GetProperty("channel").GetString());
    }

    // -------------------------------------------------------------------------
    // Fake provider flow — GET fake-pay page and POST complete
    // -------------------------------------------------------------------------

    [Fact]
    public async Task FakePayPage_IsAnonymousHtml_LabeledWithChannelName()
    {
        var userId = await factory.SeedUserAsync();
        var client = factory.CreateAuthenticatedClient(userId);
        await SetCountryAsync(client, "UA");
        var paymentId = await StartTopUpAsync(client, 10);

        // The redirect target must work in a plain browser (no JWT header).
        var anonymous = factory.CreateClient();
        var page = await anonymous.GetAsync($"/api/billing/fake-pay/{paymentId}");

        Assert.Equal(HttpStatusCode.OK, page.StatusCode);
        Assert.Contains("text/html", page.Content.Headers.ContentType?.MediaType);
        Assert.Contains("monobank", await page.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task FakePaySuccess_AddsExactlyThePaidAmount_ToExistingAllowance()
    {
        var userId = await factory.SeedUserAsync();
        await factory.SeedBillingAccountAsync(userId, allowanceUsd: 2.00m);
        var client = factory.CreateAuthenticatedClient(userId);
        await SetCountryAsync(client, "DE");

        var before = await GetJsonAsync(client, "/api/billing");
        Assert.Equal(2.00m, before.RootElement.GetProperty("allowanceUsd").GetDecimal());

        var paymentId = await StartTopUpAsync(client, 10);
        await CompleteFakePaymentAsync(paymentId, "success");

        var after = await GetJsonAsync(client, "/api/billing");
        Assert.Equal(12.00m, after.RootElement.GetProperty("allowanceUsd").GetDecimal());

        var history = await GetJsonAsync(client, "/api/billing/top-ups");
        Assert.Equal("Paid", history.RootElement[0].GetProperty("status").GetString());
    }

    [Fact]
    public async Task FakePaySuccess_UserWithoutBillingAccount_GetsEffectiveAllowancePlusAmount()
    {
        // No BillingAccount row: the effective allowance is the configured global
        // limit ($0.50, pinned in the factory). Crediting must start from that
        // effective allowance, not from zero.
        var userId = await factory.SeedUserAsync();
        var client = factory.CreateAuthenticatedClient(userId);
        await SetCountryAsync(client, "DE");

        var before = await GetJsonAsync(client, "/api/billing");
        Assert.Equal(0.50m, before.RootElement.GetProperty("allowanceUsd").GetDecimal());

        var paymentId = await StartTopUpAsync(client, 5);
        await CompleteFakePaymentAsync(paymentId, "success");

        var after = await GetJsonAsync(client, "/api/billing");
        Assert.Equal(5.50m, after.RootElement.GetProperty("allowanceUsd").GetDecimal()); // 0.50 + 5, not 0 + 5
    }

    [Fact]
    public async Task FakePaySuccess_DuplicateCompletion_IsAcknowledgedButDoesNotDoubleCredit()
    {
        var userId = await factory.SeedUserAsync();
        await factory.SeedBillingAccountAsync(userId, allowanceUsd: 1.00m);
        var client = factory.CreateAuthenticatedClient(userId);
        await SetCountryAsync(client, "UA");

        var paymentId = await StartTopUpAsync(client, 20);
        await CompleteFakePaymentAsync(paymentId, "success");

        // A repeated confirmation for an already-Paid payment is acknowledged…
        var second = await CompleteFakePaymentAsync(paymentId, "success");
        Assert.True(second.IsSuccessStatusCode);

        // …but credited only once: Pending → Paid is the only crediting transition.
        var after = await GetJsonAsync(client, "/api/billing");
        Assert.Equal(21.00m, after.RootElement.GetProperty("allowanceUsd").GetDecimal());
    }

    [Fact]
    public async Task FakePayFailure_ChangesNothing_AndHistoryShowsFailed()
    {
        var userId = await factory.SeedUserAsync();
        await factory.SeedBillingAccountAsync(userId, allowanceUsd: 3.00m);
        var client = factory.CreateAuthenticatedClient(userId);
        await SetCountryAsync(client, "DE");

        var before = await GetJsonAsync(client, "/api/billing");

        var paymentId = await StartTopUpAsync(client, 10);
        await CompleteFakePaymentAsync(paymentId, "failure");

        var after = await GetJsonAsync(client, "/api/billing");
        Assert.Equal(
            before.RootElement.GetProperty("allowanceUsd").GetDecimal(),
            after.RootElement.GetProperty("allowanceUsd").GetDecimal());
        Assert.Equal(
            before.RootElement.GetProperty("balanceUsd").GetDecimal(),
            after.RootElement.GetProperty("balanceUsd").GetDecimal());
        Assert.Equal(
            before.RootElement.GetProperty("spentUsd").GetDecimal(),
            after.RootElement.GetProperty("spentUsd").GetDecimal());

        var history = await GetJsonAsync(client, "/api/billing/top-ups");
        Assert.Equal("Failed", history.RootElement[0].GetProperty("status").GetString());
    }

    // -------------------------------------------------------------------------
    // GET /api/billing/top-ups — ordering and per-user isolation
    // -------------------------------------------------------------------------

    [Fact]
    public async Task TopUpHistory_IsNewestFirst()
    {
        var userId = await factory.SeedUserAsync();
        var client = factory.CreateAuthenticatedClient(userId);
        await SetCountryAsync(client, "DE");

        await StartTopUpAsync(client, 5);
        await StartTopUpAsync(client, 10);
        await StartTopUpAsync(client, 20);

        var history = await GetJsonAsync(client, "/api/billing/top-ups");
        var items = history.RootElement.EnumerateArray().ToList();

        Assert.Equal(3, items.Count);
        Assert.Equal(20m, items[0].GetProperty("amountUsd").GetDecimal()); // newest
        Assert.Equal(10m, items[1].GetProperty("amountUsd").GetDecimal());
        Assert.Equal(5m,  items[2].GetProperty("amountUsd").GetDecimal()); // oldest
    }

    [Fact]
    public async Task TopUps_AreIsolatedPerUser_OnePaying_DoesNotChangeAnothersBalanceCountryOrHistory()
    {
        var userA = await factory.SeedUserAsync();
        var userB = await factory.SeedUserAsync();
        var clientA = factory.CreateAuthenticatedClient(userA);
        var clientB = factory.CreateAuthenticatedClient(userB);

        await SetCountryAsync(clientA, "UA");

        var bBefore = await GetJsonAsync(clientB, "/api/billing");

        var paymentId = await StartTopUpAsync(clientA, 20);
        await CompleteFakePaymentAsync(paymentId, "success");

        // A is credited…
        var aAfter = await GetJsonAsync(clientA, "/api/billing");
        Assert.True(aAfter.RootElement.GetProperty("allowanceUsd").GetDecimal() >= 20m);

        // …while B's balance, country, and history are untouched.
        var bAfter = await GetJsonAsync(clientB, "/api/billing");
        Assert.Equal(
            bBefore.RootElement.GetProperty("allowanceUsd").GetDecimal(),
            bAfter.RootElement.GetProperty("allowanceUsd").GetDecimal());
        Assert.Equal(JsonValueKind.Null, bAfter.RootElement.GetProperty("country").ValueKind);

        var bHistory = await GetJsonAsync(clientB, "/api/billing/top-ups");
        Assert.Empty(bHistory.RootElement.EnumerateArray());
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private static async Task SetCountryAsync(HttpClient client, string country)
    {
        var response = await client.PutAsJsonAsync("/api/billing/country", new { country });
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
    }

    private static async Task<string> StartTopUpAsync(HttpClient client, int amountUsd)
    {
        var response = await client.PostAsJsonAsync("/api/billing/top-up", new { amountUsd });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return json.RootElement.GetProperty("paymentId").GetString()!;
    }

    /// <summary>
    /// Confirms a fake payment the way the fake provider page does: an anonymous
    /// browser POST (the HTML page has no JWT), sharing the webhook code path.
    /// </summary>
    private async Task<HttpResponseMessage> CompleteFakePaymentAsync(string paymentId, string outcome)
    {
        var anonymous = factory.CreateClient();
        var response = await anonymous.PostAsync(
            $"/api/billing/fake-pay/{paymentId}/complete?outcome={outcome}", null);
        Assert.True(response.IsSuccessStatusCode,
            $"fake-pay complete ({outcome}) returned {(int)response.StatusCode}");
        return response;
    }

    private static async Task<JsonDocument> GetJsonAsync(HttpClient client, string url)
    {
        var response = await client.GetAsync(url);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return JsonDocument.Parse(await response.Content.ReadAsStringAsync());
    }
}

// ---------------------------------------------------------------------------
// Fake mode OFF — the local fake-pay endpoints must not exist.
// ---------------------------------------------------------------------------

public class TopUpFakeModeOffTests(TopUpFakeModeOffApiFactory factory)
    : IClassFixture<TopUpFakeModeOffApiFactory>
{
    // Spec: 502 provider failure. With fake mode off and no Stripe/Monobank keys
    // configured, starting a top-up must surface a 502 — never a fake redirect
    // and never an unhandled 500. (Red today: the endpoints don't exist.)
    [Fact]
    public async Task TopUp_RealProviderUnconfigured_Returns502()
    {
        var userId = await factory.SeedUserAsync();
        var client = factory.CreateAuthenticatedClient(userId);

        var put = await client.PutAsJsonAsync("/api/billing/country", new { country = "DE" });
        Assert.Equal(HttpStatusCode.NoContent, put.StatusCode);

        var response = await client.PostAsJsonAsync("/api/billing/top-up", new { amountUsd = 10 });
        Assert.Equal(HttpStatusCode.BadGateway, response.StatusCode);
    }

    // NOTE: the two 404 tests below pass even before the implementation exists
    // (the routes are missing either way). They are kept deliberately: once the
    // fake-pay endpoints are implemented, they pin the contract that fake mode
    // OFF hides them — guarding against unconditional endpoint registration.
    [Fact]
    public async Task FakePayPage_Returns404_WhenFakeModeOff()
    {
        var userId = await factory.SeedUserAsync();
        var client = factory.CreateAuthenticatedClient(userId);

        var response = await client.GetAsync($"/api/billing/fake-pay/{Guid.NewGuid()}");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task FakePayComplete_Returns404_WhenFakeModeOff()
    {
        var userId = await factory.SeedUserAsync();
        var client = factory.CreateAuthenticatedClient(userId);

        var response = await client.PostAsync(
            $"/api/billing/fake-pay/{Guid.NewGuid()}/complete?outcome=success", null);
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}

// ---------------------------------------------------------------------------
// Shared factory — mirrors ExtractionApiFactory (JWT patch, InMemory EF swap,
// mocked ILlmService) and pins the billing/usage config the tests rely on.
// ---------------------------------------------------------------------------

public class TopUpApiFactory : WebApplicationFactory<Program>
{
    /// <summary>Shared fake persistence for this factory (ADR-0021 seam).</summary>
    public InMemoryStore Store { get; } = new();

    protected virtual bool UseFakeProviders => true;

    private const string JwtSecret   = "test-secret-key-for-hmacsha256-exactly-32ch";
    private const string JwtIssuer   = "test-issuer";
    private const string JwtAudience = "test-audience";

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");

        // Billing payment config (doc/web-client/specs/billing.md §1). Fake mode
        // routes both channels to the local /api/billing/fake-pay/* endpoints.
        builder.UseSetting("Billing:Payments:UseFakeProviders", UseFakeProviders ? "true" : "false");
        builder.UseSetting("Billing:Payments:PublicBaseUrl", "http://localhost");
        builder.UseSetting("Billing:Payments:SpaBaseUrl", "http://localhost:4200");
        // Pin the effective allowance for users without a BillingAccount row.
        builder.UseSetting("UsageLimit:MaxCostUsdPerUser", "0.50");

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

            // Fake the ADR-0021 seam (see ExtractionApiFactory).
            services.UseInMemoryStore(Store);

            // Billing tests never talk to the LLM; replace the gRPC-backed service.
            foreach (var d in services.Where(d => d.ServiceType == typeof(ILlmService)).ToList())
                services.Remove(d);
            services.AddScoped<ILlmService>(_ => new Mock<ILlmService>().Object);
        });
    }

    public async Task<Guid> SeedUserAsync()
    {
        using var scope = Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<InMemoryStore>();

        var user = new User { Email = $"{Guid.NewGuid():n}@example.com" };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return user.Id;
    }

    public async Task SeedBillingAccountAsync(Guid userId, decimal allowanceUsd)
    {
        using var scope = Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<InMemoryStore>();

        db.BillingAccounts.Add(new BillingAccount
        {
            UserId = userId,
            AllowanceUsd = allowanceUsd,
            Currency = "USD",
            UpdatedAt = DateTime.UtcNow,
        });
        await db.SaveChangesAsync();
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

public class TopUpFakeModeOffApiFactory : TopUpApiFactory
{
    protected override bool UseFakeProviders => false;
}

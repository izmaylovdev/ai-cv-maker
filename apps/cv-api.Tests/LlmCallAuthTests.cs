using CvApi.Infrastructure.ExternalServices.Llm;
using Grpc.Core;
using Moq;

namespace CvApi.Tests;

// US-AUTH-6 (F-AUTH-6.3, F-AUTH-6.5) — cv-api attaches a Google-signed ID token
// to llm-service gRPC calls in Cloud Run, and attaches nothing in local mode.
public class LlmCallAuthTests
{
    // -------------------------------------------------------------------------
    // Provider selection by LlmService:AuthMode
    // -------------------------------------------------------------------------

    [Theory]
    [InlineData("none")]
    [InlineData("")]
    [InlineData(null)]
    public void CreateTokenProvider_NoneOrUnset_ReturnsNullProvider(string? authMode)
    {
        var provider = LlmCallAuth.CreateTokenProvider(authMode, "https://llm.example.run.app");

        Assert.IsType<NullLlmCallTokenProvider>(provider);
    }

    [Fact]
    public void CreateTokenProvider_Google_ReturnsGoogleProvider()
    {
        var provider = LlmCallAuth.CreateTokenProvider("google", "https://llm.example.run.app");

        Assert.IsType<GoogleIdTokenProvider>(provider);
    }

    [Fact]
    public void CreateTokenProvider_GoogleWithoutAudience_Throws()
    {
        Assert.Throws<InvalidOperationException>(
            () => LlmCallAuth.CreateTokenProvider("google", ""));
    }

    [Fact]
    public void CreateTokenProvider_UnknownMode_Throws()
    {
        Assert.Throws<InvalidOperationException>(
            () => LlmCallAuth.CreateTokenProvider("kerberos", "https://llm.example.run.app"));
    }

    // -------------------------------------------------------------------------
    // Metadata application
    // -------------------------------------------------------------------------

    [Fact]
    public async Task ApplyAsync_ProviderReturnsToken_AddsBearerAuthorizationHeader()
    {
        var tokenProvider = new Mock<ILlmCallTokenProvider>();
        tokenProvider.Setup(p => p.GetTokenAsync(It.IsAny<CancellationToken>()))
                     .ReturnsAsync("id-token-123");
        var metadata = new Metadata();

        await LlmCallAuth.ApplyAsync(tokenProvider.Object, metadata, CancellationToken.None);

        var entry = Assert.Single(metadata);
        Assert.Equal("authorization", entry.Key);
        Assert.Equal("Bearer id-token-123", entry.Value);
    }

    [Fact]
    public async Task ApplyAsync_ProviderReturnsNull_AddsNothing()
    {
        var tokenProvider = new Mock<ILlmCallTokenProvider>();
        tokenProvider.Setup(p => p.GetTokenAsync(It.IsAny<CancellationToken>()))
                     .ReturnsAsync((string?)null);
        var metadata = new Metadata();

        await LlmCallAuth.ApplyAsync(tokenProvider.Object, metadata, CancellationToken.None);

        Assert.Empty(metadata);
    }

    [Fact]
    public async Task NullProvider_ReturnsNullToken()
    {
        var provider = new NullLlmCallTokenProvider();

        Assert.Null(await provider.GetTokenAsync(CancellationToken.None));
    }
}

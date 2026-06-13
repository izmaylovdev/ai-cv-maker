using CvApi.Features.Admin;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;

namespace CvApi.Tests;

public class AdminApiKeyFilterTests
{
    private static AuthorizationFilterContext MakeContext(string? configuredKey, string? headerValue)
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(configuredKey is null
                ? new Dictionary<string, string?>()
                : new Dictionary<string, string?> { ["AdminApi:ApiKey"] = configuredKey })
            .Build();

        var httpContext = new DefaultHttpContext();
        if (headerValue is not null)
            httpContext.Request.Headers[AdminApiKeyFilter.HeaderName] = headerValue;

        var actionContext = new ActionContext(httpContext, new RouteData(), new ActionDescriptor());
        var ctx = new AuthorizationFilterContext(actionContext, new List<IFilterMetadata>());
        new AdminApiKeyFilter(config).OnAuthorization(ctx);
        return ctx;
    }

    [Fact]
    public void ValidKey_Passes()
        => Assert.Null(MakeContext("s3cret", "s3cret").Result);

    [Fact]
    public void WrongKey_Unauthorized()
        => Assert.IsType<UnauthorizedResult>(MakeContext("s3cret", "nope").Result);

    [Fact]
    public void MissingHeader_Unauthorized()
        => Assert.IsType<UnauthorizedResult>(MakeContext("s3cret", null).Result);

    [Fact]
    public void UnconfiguredKey_FailsClosed()
        => Assert.IsType<UnauthorizedResult>(MakeContext(null, "anything").Result);
}

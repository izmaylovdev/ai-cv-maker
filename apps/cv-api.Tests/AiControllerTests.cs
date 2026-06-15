using System.Security.Claims;
using CvApi.Features.Ai;
using CvApi.Features.JobProfiles.Dtos;
using CvApi.Features.Usage;
using CvApi.Infrastructure.ExternalServices.Llm;
using CvApi.Infrastructure.Persistence;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Moq;

namespace CvApi.Tests;

// Error mapping for POST /api/ai/enhance-field: an unreachable llm-service must
// surface as a 503 with a clear message, not an unhandled 500.
public class AiControllerTests
{
    private static UsageService UsageService()
    {
        var opts = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        var db = new AppDbContext(opts);
        var pricing = Options.Create(new LlmPricingOptions
        {
            Models = new() { ["default"] = new LlmPricingModel { PromptCostPer1M = 3m, CompletionCostPer1M = 15m } },
        });
        var limit = Options.Create(new UsageLimitOptions { MaxCostUsdPerUser = 100m });
        return new UsageService(db, pricing, limit);
    }

    private static AiController BuildController(ILlmService llm)
    {
        var controller = new AiController(llm, UsageService())
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity(
                        [new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString())])),
                },
            },
        };
        return controller;
    }

    [Fact]
    public async Task EnhanceField_LlmUnavailable_Returns503()
    {
        var llm = new Mock<ILlmService>();
        llm.Setup(s => s.EnhanceFieldAsync(It.IsAny<LlmEnhanceFieldRequest>()))
            .ThrowsAsync(new LlmUnavailableException("The AI service is currently unreachable. Please try again later."));

        var controller = BuildController(llm.Object);

        var result = await controller.EnhanceField(new EnhanceFieldRequest("some text", "summary"));

        var status = Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal(503, status.StatusCode);
    }

    [Fact]
    public async Task EnhanceField_RateLimited_Returns503()
    {
        var llm = new Mock<ILlmService>();
        llm.Setup(s => s.EnhanceFieldAsync(It.IsAny<LlmEnhanceFieldRequest>()))
            .ThrowsAsync(new LlmRateLimitException("quota exceeded"));

        var controller = BuildController(llm.Object);

        var result = await controller.EnhanceField(new EnhanceFieldRequest("some text", "summary"));

        var status = Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal(503, status.StatusCode);
    }
}

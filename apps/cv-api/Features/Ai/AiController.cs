using System.Security.Claims;
using CvApi.Features.JobProfiles.Dtos;
using CvApi.Features.Usage;
using CvApi.Infrastructure.ExternalServices.Llm;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace CvApi.Features.Ai;

[ApiController]
[Route("api/ai")]
[Authorize]
public class AiController(ILlmService llmService, UsageService usageService) : ControllerBase
{
    private Guid UserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpPost("enhance-field")]
    public async Task<ActionResult<EnhanceFieldResponse>> EnhanceField(EnhanceFieldRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Content))
            return BadRequest("Content is required.");

        if (string.IsNullOrWhiteSpace(request.FieldPurpose))
            return BadRequest("FieldPurpose is required.");

        await usageService.EnsureWithinLimitAsync(UserId);

        try
        {
            var llmResponse = await llmService.EnhanceFieldAsync(new LlmEnhanceFieldRequest(request.Content, request.FieldPurpose));
            await usageService.RecordAsync(UserId, "EnhanceField", llmResponse.Usage);
            return Ok(new EnhanceFieldResponse(llmResponse.Enhanced));
        }
        catch (LlmRateLimitException)
        {
            return StatusCode(503, "AI enhancement is temporarily unavailable. Please try again later.");
        }
        catch (HttpRequestException ex) when (ex.StatusCode == System.Net.HttpStatusCode.TooManyRequests)
        {
            return StatusCode(503, "AI enhancement is temporarily unavailable. Please try again later.");
        }
        catch (HttpRequestException ex)
        {
            return StatusCode(502, $"AI enhancement failed: {ex.Message}");
        }
    }
}

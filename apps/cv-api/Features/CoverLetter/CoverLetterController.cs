using System.Security.Claims;
using CvApi.Infrastructure.ExternalServices.Llm;
using Grpc.Core;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Polly.CircuitBreaker;

namespace CvApi.Features.CoverLetter;

[ApiController]
[Route("api/cover-letter")]
[Authorize]
public class CoverLetterController(CoverLetterService coverLetterService) : ControllerBase
{
    private Guid UserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpPost]
    public async Task<ActionResult<GenerateCoverLetterResponse>> Generate(GenerateCoverLetterRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.JobDescription))
            return BadRequest("JobDescription is required.");

        try
        {
            var result = await coverLetterService.GenerateAsync(UserId, request);
            return Ok(result);
        }
        catch (KeyNotFoundException ex)
        {
            return NotFound(new { error = ex.Message });
        }
        catch (InvalidOperationException ex)
        {
            return UnprocessableEntity(new { error = ex.Message });
        }
        catch (BrokenCircuitException)
        {
            return StatusCode(503, "Cover letter generation is temporarily unavailable: the AI service is unreachable. Please try again later.");
        }
        catch (LlmRateLimitException)
        {
            return StatusCode(503, "Cover letter generation is temporarily unavailable: the AI service has exceeded its quota. Please try again later.");
        }
        catch (RpcException ex) when (ex.StatusCode == global::Grpc.Core.StatusCode.InvalidArgument)
        {
            return UnprocessableEntity(new { error = ex.Status.Detail });
        }
    }
}

using System.Security.Claims;
using CvApi.Features.JobProfiles.Dtos;
using CvApi.Infrastructure.ExternalServices.Llm;
using Grpc.Core;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Polly.CircuitBreaker;

namespace CvApi.Features.JobProfiles;

[ApiController]
[Route("api/job-profiles")]
[Authorize]
public class JobProfileController(IJobProfileService jobProfileService) : ControllerBase
{
    private Guid UserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpGet]
    public async Task<ActionResult<List<JobProfileListItemDto>>> List()
        => Ok(await jobProfileService.ListAsync(UserId));

    [HttpPost]
    public async Task<ActionResult<JobProfileListItemDto>> Create(CreateJobProfileRequest request)
        => Ok(await jobProfileService.CreateAsync(UserId, request));

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<ProfileDto>> Get(Guid id)
    {
        var result = await jobProfileService.GetAsync(id, UserId);
        return result is null ? NotFound() : Ok(result);
    }

    [HttpPut("{id:guid}")]
    public async Task<ActionResult<ProfileDto>> Update(Guid id, UpdateProfileRequest request)
    {
        var result = await jobProfileService.UpdateAsync(id, UserId, request);
        return result is null ? NotFound() : Ok(result);
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id)
    {
        var deleted = await jobProfileService.DeleteAsync(id, UserId);
        return deleted ? NoContent() : NotFound();
    }

    [HttpPost("{id:guid}/optimize")]
    public async Task<ActionResult<OptimizeProfileResponse>> Optimize(Guid id, OptimizeProfileRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Message))
            return BadRequest("Message is required.");

        OptimizeProfileResponse? result;
        try
        {
            result = await jobProfileService.OptimizeAsync(id, UserId, request);
        }
        catch (RpcException ex) when (ex.StatusCode == global::Grpc.Core.StatusCode.InvalidArgument)
        {
            return UnprocessableEntity(new { error = ex.Status.Detail });
        }
        catch (BrokenCircuitException)
        {
            return StatusCode(503, "Profile optimization is temporarily unavailable: the AI service is unreachable. Please try again later.");
        }
        catch (LlmRateLimitException)
        {
            return StatusCode(503, "Profile optimization is temporarily unavailable: the AI service has exceeded its quota. Please try again later.");
        }
        catch (HttpRequestException ex) when (ex.StatusCode == System.Net.HttpStatusCode.TooManyRequests)
        {
            return StatusCode(503, "Profile optimization is temporarily unavailable: the AI service has exceeded its quota. Please try again later.");
        }
        catch (HttpRequestException ex)
        {
            return StatusCode(502, $"Profile optimization failed: {ex.Message}");
        }

        return result is null ? NotFound() : Ok(result);
    }

    [HttpPost("{id:guid}/chat")]
    public async Task<ActionResult<ChatResponse>> Chat(Guid id, ChatRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Message))
            return BadRequest("Message is required.");

        ChatResponse? result;
        try
        {
            result = await jobProfileService.ChatAsync(id, UserId, request);
        }
        catch (Exception ex)
        {
            return StatusCode(502, $"Chat failed: {ex.Message}");
        }

        return result is null ? NotFound() : Ok(result);
    }

    [HttpPost("{id:guid}/extract")]
    [RequestSizeLimit(10 * 1024 * 1024)]
    public async Task<ActionResult<UpdateProfileRequest>> Extract(Guid id, IFormFile file)
    {
        if (file is null || file.Length == 0)
            return BadRequest("No file uploaded.");

        UpdateProfileRequest? result;
        try
        {
            result = await jobProfileService.ExtractAsync(id, UserId, file);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(ex.Message);
        }
        catch (BrokenCircuitException)
        {
            return StatusCode(503, "CV extraction is temporarily unavailable: the AI service is unreachable. Please try again later.");
        }
        catch (LlmRateLimitException)
        {
            return StatusCode(503, "CV extraction is temporarily unavailable: the AI service has exceeded its quota. Please try again later.");
        }
        catch (HttpRequestException ex) when (ex.StatusCode == System.Net.HttpStatusCode.TooManyRequests)
        {
            return StatusCode(503, "CV extraction is temporarily unavailable: the AI service has exceeded its quota. Please try again later.");
        }
        catch (HttpRequestException ex)
        {
            return StatusCode(502, $"CV extraction failed: {ex.Message}");
        }

        if (result is null) return NotFound();
        return Ok(result);
    }
}

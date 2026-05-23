using System.Security.Claims;
using CvApi.Features.Cvs.Dtos;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace CvApi.Features.Cvs;

[ApiController]
[Route("api/job-profiles/{profileId:guid}/cvs")]
[Authorize]
public class CvController(ICvService cvService) : ControllerBase
{
    private Guid UserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpGet]
    public async Task<ActionResult<List<CvListItemDto>>> GetAll(Guid profileId)
    {
        var result = await cvService.GetAllAsync(profileId, UserId);
        return result is null ? NotFound() : Ok(result);
    }

    [HttpPost]
    public async Task<ActionResult<CvListItemDto>> Create(Guid profileId, CreateCvRequest request)
    {
        CvListItemDto? result;
        try
        {
            result = await cvService.CreateAsync(profileId, UserId, request);
        }
        catch (HttpRequestException ex) when (ex.StatusCode == System.Net.HttpStatusCode.TooManyRequests)
        {
            return StatusCode(503, "CV generation is temporarily unavailable: the AI service has exceeded its quota. Please try again later.");
        }
        catch (HttpRequestException ex)
        {
            return StatusCode(502, $"CV generation failed: {ex.Message}");
        }

        return result is null ? NotFound() : Ok(result);
    }

    [HttpGet("{id:guid}/pdf")]
    public async Task<IActionResult> GetPdf(Guid profileId, Guid id)
    {
        var result = await cvService.GetPdfAsync(profileId, id, UserId);
        if (result is null) return NotFound();
        return File(result.Value.Bytes, "application/pdf", result.Value.Filename);
    }

    [HttpGet("default/pdf")]
    public async Task<IActionResult> GetDefaultPdf(Guid profileId)
    {
        var result = await cvService.GetDefaultPdfAsync(profileId, UserId);
        if (result is null) return NotFound();
        return File(result.Value.Bytes, "application/pdf", result.Value.Filename);
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid profileId, Guid id)
    {
        var deleted = await cvService.DeleteAsync(profileId, id, UserId);
        return deleted ? NoContent() : NotFound();
    }
}

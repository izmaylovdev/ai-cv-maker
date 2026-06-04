using System.Security.Claims;
using Grpc.Core;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

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
        catch (RpcException ex) when (ex.StatusCode == global::Grpc.Core.StatusCode.InvalidArgument)
        {
            return UnprocessableEntity(new { error = ex.Status.Detail });
        }
    }
}

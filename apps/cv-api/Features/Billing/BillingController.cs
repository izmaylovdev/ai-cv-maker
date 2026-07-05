using System.Security.Claims;
using CvApi.Features.Usage;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace CvApi.Features.Billing;

[ApiController]
[Route("api/billing")]
[Authorize]
public class BillingController(UsageService usageService) : ControllerBase
{
    private Guid UserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpGet]
    public async Task<BillingSummaryDto> GetMyBilling()
        => await usageService.GetBillingSummaryAsync(UserId);
}

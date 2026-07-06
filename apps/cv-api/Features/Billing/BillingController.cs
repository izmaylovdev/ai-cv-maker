using System.Security.Claims;
using System.Text.Json;
using System.Text.RegularExpressions;
using CvApi.Domain.Entities;
using CvApi.Features.Billing.Channels;
using CvApi.Features.Usage;
using CvApi.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Stripe;
using Stripe.Checkout;

namespace CvApi.Features.Billing;

[ApiController]
[Route("api/billing")]
[Authorize]
public partial class BillingController(
    UsageService usageService,
    TopUpService topUpService,
    PaymentConfirmationService confirmationService,
    MonobankSignatureVerifier monobankSignatureVerifier,
    IOptions<PaymentsOptions> paymentsOptions,
    AppDbContext db) : ControllerBase
{
    [GeneratedRegex("^[A-Z]{2}$")]
    private static partial Regex IsoAlpha2Regex();

    private Guid UserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    [HttpGet]
    public async Task<BillingSummaryDto> GetMyBilling()
        => await usageService.GetBillingSummaryAsync(UserId);

    /// <summary>
    /// Stores the user's payment country (US-BILL-1, F-BILL-1.2/1.3). Exactly
    /// two uppercase ASCII letters (ISO 3166-1 alpha-2); asked once at first
    /// top-up and editable any time before a payment.
    /// </summary>
    [HttpPut("country")]
    public async Task<IActionResult> SetCountry([FromBody] UpdateCountryRequest request)
    {
        if (request.Country is null || !IsoAlpha2Regex().IsMatch(request.Country))
            return BadRequest(new { error = "Country must be a two-letter uppercase ISO 3166-1 alpha-2 code." });

        var user = await db.Users.FirstOrDefaultAsync(u => u.Id == UserId);
        if (user is null)
            return NotFound();

        user.Country = request.Country;
        await db.SaveChangesAsync();
        return NoContent();
    }

    /// <summary>
    /// Starts a top-up (US-BILL-1). 400: amount not in {5, 10, 20}; 409: no
    /// country stored yet (the client must ask for it first); 502: the payment
    /// provider call failed.
    /// </summary>
    [HttpPost("top-up")]
    public async Task<IActionResult> StartTopUp([FromBody] TopUpRequest request, CancellationToken ct)
    {
        if (!TopUpService.AllowedAmounts.Contains(request.AmountUsd))
            return BadRequest(new { error = "Amount must be one of $5, $10, $20." });

        var country = await db.Users
            .Where(u => u.Id == UserId)
            .Select(u => u.Country)
            .FirstOrDefaultAsync(ct);
        if (country is null)
            return Conflict(new { error = "A payment country must be stored before topping up." });

        try
        {
            return Ok(await topUpService.StartAsync(UserId, request.AmountUsd, country, ct));
        }
        catch (PaymentProviderException)
        {
            return StatusCode(StatusCodes.Status502BadGateway,
                new { error = "The payment provider is unavailable. Please try again later." });
        }
    }

    /// <summary>Top-up history for the caller, newest first (F-BILL-1.7).</summary>
    [HttpGet("top-ups")]
    public async Task<List<TopUpHistoryItemDto>> GetTopUps()
        => await topUpService.GetHistoryAsync(UserId);

    /// <summary>
    /// Stripe webhook (US-BILL-1). Signature-verified; `checkout.session.completed`
    /// marks the payment Paid (and credits it), `checkout.session.expired` marks
    /// it Failed. Unknown payments and duplicate deliveries are acknowledged.
    /// </summary>
    [HttpPost("webhooks/stripe")]
    [AllowAnonymous]
    public async Task<IActionResult> StripeWebhook(CancellationToken ct)
    {
        using var reader = new StreamReader(Request.Body);
        var payload = await reader.ReadToEndAsync(ct);

        Event stripeEvent;
        try
        {
            stripeEvent = EventUtility.ConstructEvent(
                payload,
                Request.Headers["Stripe-Signature"],
                paymentsOptions.Value.Stripe.WebhookSecret);
        }
        catch (StripeException)
        {
            return BadRequest();
        }

        if (stripeEvent.Type is "checkout.session.completed" or "checkout.session.expired"
            && stripeEvent.Data.Object is Session session)
        {
            var payment = await FindPaymentAsync(session.Id, session.ClientReferenceId, ct);
            if (payment is not null)
                await confirmationService.ConfirmAsync(
                    payment, success: stripeEvent.Type == "checkout.session.completed", ct);
        }

        return Ok(); // unknown payments and duplicates are acknowledged
    }

    /// <summary>
    /// Monobank webhook (US-BILL-1). The X-Sign ECDSA signature of the raw body
    /// is verified against Monobank's public key; `success` marks the payment
    /// Paid (and credits it), `failure`/`expired`/`reversed` mark it Failed,
    /// intermediate statuses (`created`/`processing`/`hold`) are ignored.
    /// </summary>
    [HttpPost("webhooks/monobank")]
    [AllowAnonymous]
    public async Task<IActionResult> MonobankWebhook(CancellationToken ct)
    {
        using var buffer = new MemoryStream();
        await Request.Body.CopyToAsync(buffer, ct);
        var body = buffer.ToArray();

        var signature = Request.Headers["X-Sign"].ToString();
        if (string.IsNullOrEmpty(signature)
            || !await monobankSignatureVerifier.VerifyAsync(signature, body, ct))
            return BadRequest();

        MonobankWebhookPayload? payload;
        try
        {
            payload = JsonSerializer.Deserialize<MonobankWebhookPayload>(body, JsonSerializerOptions.Web);
        }
        catch (JsonException)
        {
            return BadRequest();
        }

        var success = payload?.Status == "success";
        var failed = payload?.Status is "failure" or "expired" or "reversed";
        if (payload is null || (!success && !failed))
            return Ok(); // created / processing / hold — nothing to do yet

        var payment = await FindPaymentAsync(payload.InvoiceId, payload.Reference, ct);
        if (payment is not null)
            await confirmationService.ConfirmAsync(payment, success, ct);

        return Ok();
    }

    /// <summary>Looks a payment up by provider external id, falling back to the payment id reference.</summary>
    private async Task<TopUpPayment?> FindPaymentAsync(
        string? externalId, string? reference, CancellationToken ct)
    {
        TopUpPayment? payment = null;
        if (!string.IsNullOrEmpty(externalId))
            payment = await db.TopUpPayments.FirstOrDefaultAsync(p => p.ExternalId == externalId, ct);
        if (payment is null && Guid.TryParse(reference, out var paymentId))
            payment = await db.TopUpPayments.FirstOrDefaultAsync(p => p.Id == paymentId, ct);
        return payment;
    }

    private sealed record MonobankWebhookPayload(string? InvoiceId, string? Status, string? Reference);
}

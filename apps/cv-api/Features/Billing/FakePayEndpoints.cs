using CvApi.Domain.Repositories;
using Microsoft.Extensions.Options;

namespace CvApi.Features.Billing;

/// <summary>
/// Local fake-payment pages (US-BILL-1, F-BILL-1.9). Mapped from Program.cs
/// ONLY when <c>Billing:Payments:UseFakeProviders</c> is true, so the routes
/// 404 in real-provider mode. Anonymous by design: the redirect lands in a
/// plain browser tab, exactly like a real provider's checkout page.
/// </summary>
public static class FakePayEndpoints
{
    public static void MapFakePayEndpoints(this IEndpointRouteBuilder app)
    {
        // The "checkout page": labeled with the channel flavor, with Pay/Cancel
        // buttons that hit the complete endpoint and bounce back to the SPA.
        app.MapGet("/api/billing/fake-pay/{paymentId:guid}", async (
            Guid paymentId,
            ITopUpPaymentRepository payments,
            IOptions<PaymentsOptions> options,
            CancellationToken ct) =>
        {
            var payment = await payments.GetByIdAsync(paymentId, ct);
            if (payment is null)
                return Results.NotFound();

            var spaBaseUrl = options.Value.SpaBaseUrl.TrimEnd('/');
            var html = $$"""
                <!DOCTYPE html>
                <html lang="en">
                <head>
                  <meta charset="utf-8">
                  <title>Fake payment — {{payment.Channel}}</title>
                  <style>
                    body { font-family: system-ui, sans-serif; max-width: 28rem; margin: 4rem auto; }
                    button { font-size: 1rem; padding: .6rem 1.4rem; margin-right: .5rem; cursor: pointer; }
                  </style>
                </head>
                <body>
                  <h1>Fake {{payment.Channel}} payment</h1>
                  <p>Top up <strong>${{payment.AmountUsd:0.##}}</strong> via <strong>{{payment.Channel}}</strong>.</p>
                  <p>This page exists only in fake-provider mode (local/dev).</p>
                  <button onclick="complete('success')">Pay ${{payment.AmountUsd:0.##}}</button>
                  <button onclick="complete('failure')">Cancel</button>
                  <script>
                    function complete(outcome) {
                      fetch('/api/billing/fake-pay/{{payment.Id}}/complete?outcome=' + outcome, { method: 'POST' })
                        .then(function () {
                          window.location.href = '{{spaBaseUrl}}/billing?topup={{payment.Id}}&outcome=' + outcome;
                        });
                    }
                  </script>
                </body>
                </html>
                """;
            return Results.Content(html, "text/html");
        });

        // Confirmation goes through the SAME code path as the real webhooks
        // (PaymentConfirmationService), so fake mode exercises the crediting
        // and idempotency rules for real.
        app.MapPost("/api/billing/fake-pay/{paymentId:guid}/complete", async (
            Guid paymentId,
            string outcome,
            ITopUpPaymentRepository payments,
            PaymentConfirmationService confirmationService,
            CancellationToken ct) =>
        {
            if (outcome is not ("success" or "failure"))
                return Results.BadRequest(new { error = "outcome must be 'success' or 'failure'." });

            var payment = await payments.GetByIdAsync(paymentId, ct);
            if (payment is null)
                return Results.NotFound();

            await confirmationService.ConfirmAsync(payment, outcome == "success", ct);
            return Results.Ok(); // already-terminal payments are acknowledged too
        });
    }
}

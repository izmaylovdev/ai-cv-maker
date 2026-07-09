using CvApi.Domain.Entities;
using Microsoft.Extensions.Options;
using Stripe;
using Stripe.Checkout;

namespace CvApi.Features.Billing.Channels;

/// <summary>
/// Stripe Checkout channel (US-BILL-1): one-off payment Session with a single
/// USD line item. The Checkout Session id becomes the payment's
/// <c>ExternalId</c>; the webhook correlates by that id (or by
/// <c>client_reference_id</c>, which carries the payment id).
/// </summary>
public class StripeChannel(IOptions<PaymentsOptions> options) : IPaymentChannel
{
    public string Name => "stripe";

    public async Task<PaymentRedirect> CreatePaymentAsync(TopUpPayment payment, CancellationToken ct)
    {
        var opts = options.Value;
        if (string.IsNullOrWhiteSpace(opts.Stripe.SecretKey))
            throw new PaymentProviderException("Stripe secret key is not configured.");

        var spaBaseUrl = opts.SpaBaseUrl.TrimEnd('/');
        var sessionOptions = new SessionCreateOptions
        {
            Mode = "payment",
            ClientReferenceId = payment.Id.ToString(),
            SuccessUrl = $"{spaBaseUrl}/billing?topup={payment.Id}&outcome=success",
            CancelUrl = $"{spaBaseUrl}/billing?topup={payment.Id}&outcome=cancelled",
            LineItems =
            [
                new SessionLineItemOptions
                {
                    Quantity = 1,
                    PriceData = new SessionLineItemPriceDataOptions
                    {
                        Currency = "usd",
                        UnitAmount = (long)(payment.AmountUsd * 100m),
                        ProductData = new SessionLineItemPriceDataProductDataOptions
                        {
                            Name = "Applysy balance top-up",
                        },
                    },
                },
            ],
        };

        try
        {
            var service = new SessionService(new StripeClient(opts.Stripe.SecretKey));
            var session = await service.CreateAsync(sessionOptions, cancellationToken: ct);
            return new PaymentRedirect(session.Id, session.Url);
        }
        catch (StripeException ex)
        {
            throw new PaymentProviderException("Stripe Checkout Session creation failed.", ex);
        }
    }
}

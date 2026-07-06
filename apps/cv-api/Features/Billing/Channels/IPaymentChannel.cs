using CvApi.Domain.Entities;

namespace CvApi.Features.Billing.Channels;

/// <summary>Provider-side payment handle: external id plus the URL the user is sent to.</summary>
public record PaymentRedirect(string ExternalId, string RedirectUrl);

/// <summary>
/// A payment acquiring channel (US-BILL-1). Real implementations: Stripe
/// Checkout and Monobank invoice; dev fakes redirect to the local fake-pay page.
/// </summary>
public interface IPaymentChannel
{
    /// <summary>"stripe" | "monobank" (fake implementations: "fake-stripe" | "fake-monobank").</summary>
    string Name { get; }

    /// <summary>Creates the provider-side payment and returns (externalId, redirectUrl).</summary>
    Task<PaymentRedirect> CreatePaymentAsync(TopUpPayment payment, CancellationToken ct);
}

/// <summary>
/// Thrown when the payment provider call fails or the provider is not
/// configured. Mapped to HTTP 502 by <c>BillingController</c>.
/// </summary>
public class PaymentProviderException(string message, Exception? innerException = null)
    : Exception(message, innerException);

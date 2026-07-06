using CvApi.Domain.Entities;
using Microsoft.Extensions.Options;

namespace CvApi.Features.Billing.Channels;

/// <summary>
/// Fake payment channels (US-BILL-1, F-BILL-1.9). Registered instead of the
/// real ones when <c>Billing:Payments:UseFakeProviders</c> is true; they
/// redirect to the local fake-pay page so the full flow works without provider
/// credentials. Names keep the real channel flavor ("fake-stripe" /
/// "fake-monobank") so routing and history stay observable.
/// </summary>
public abstract class FakePaymentChannelBase(IOptions<PaymentsOptions> options) : IPaymentChannel
{
    public abstract string Name { get; }

    public Task<PaymentRedirect> CreatePaymentAsync(TopUpPayment payment, CancellationToken ct)
    {
        var baseUrl = options.Value.PublicBaseUrl.TrimEnd('/');
        return Task.FromResult(new PaymentRedirect(
            $"fake-{payment.Id}",
            $"{baseUrl}/api/billing/fake-pay/{payment.Id}"));
    }
}

public class FakeStripeChannel(IOptions<PaymentsOptions> options) : FakePaymentChannelBase(options)
{
    public override string Name => "fake-stripe";
}

public class FakeMonobankChannel(IOptions<PaymentsOptions> options) : FakePaymentChannelBase(options)
{
    public override string Name => "fake-monobank";
}

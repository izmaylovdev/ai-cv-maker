namespace CvApi.Features.Billing.Channels;

/// <summary>
/// Routes a top-up to a payment channel by the user's stored country
/// (US-BILL-1, F-BILL-1.4): <c>UA</c> → the monobank-flavored channel, any
/// other country → the stripe-flavored one. Which implementations are
/// registered (real vs fake) is decided at startup from
/// <c>Billing:Payments:UseFakeProviders</c>; both flavors match by name here.
/// </summary>
public class PaymentChannelResolver(IEnumerable<IPaymentChannel> channels)
{
    public IPaymentChannel Resolve(string country)
    {
        var flavor = country == "UA" ? "monobank" : "stripe";
        return channels.First(c => c.Name.Contains(flavor, StringComparison.Ordinal));
    }
}

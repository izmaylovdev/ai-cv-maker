using CvApi.Domain.Entities;
using Microsoft.Extensions.Options;

namespace CvApi.Features.Billing.Channels;

/// <summary>
/// Monobank acquiring channel (US-BILL-1): creates a merchant invoice priced in
/// UAH kopecks at the configured fixed <c>UahPerUsd</c> rate (no live FX in the
/// MVP — the balance is still credited in USD). The <c>invoiceId</c> becomes the
/// payment's <c>ExternalId</c>; the webhook correlates by it (or by
/// <c>reference</c>, which carries the payment id).
/// </summary>
public class MonobankChannel(
    IHttpClientFactory httpClientFactory,
    IOptions<PaymentsOptions> options) : IPaymentChannel
{
    private const string InvoiceCreateUrl = "https://api.monobank.ua/api/merchant/invoice/create";

    public string Name => "monobank";

    public async Task<PaymentRedirect> CreatePaymentAsync(TopUpPayment payment, CancellationToken ct)
    {
        var opts = options.Value;
        if (string.IsNullOrWhiteSpace(opts.Monobank.Token))
            throw new PaymentProviderException("Monobank merchant token is not configured.");

        var spaBaseUrl = opts.SpaBaseUrl.TrimEnd('/');
        var request = new HttpRequestMessage(HttpMethod.Post, InvoiceCreateUrl)
        {
            Content = JsonContent.Create(new
            {
                amount = (long)Math.Round(payment.AmountUsd * opts.Monobank.UahPerUsd * 100m),
                ccy = 980, // UAH
                redirectUrl = $"{spaBaseUrl}/billing?topup={payment.Id}&outcome=success",
                webHookUrl = $"{opts.PublicBaseUrl.TrimEnd('/')}/api/billing/webhooks/monobank",
                reference = payment.Id.ToString(),
            }),
        };
        request.Headers.Add("X-Token", opts.Monobank.Token);

        try
        {
            var client = httpClientFactory.CreateClient(nameof(MonobankChannel));
            var response = await client.SendAsync(request, ct);
            if (!response.IsSuccessStatusCode)
                throw new PaymentProviderException(
                    $"Monobank invoice creation failed with HTTP {(int)response.StatusCode}.");

            var invoice = await response.Content.ReadFromJsonAsync<MonobankInvoiceResponse>(ct);
            if (invoice is null
                || string.IsNullOrEmpty(invoice.InvoiceId)
                || string.IsNullOrEmpty(invoice.PageUrl))
                throw new PaymentProviderException("Monobank returned an incomplete invoice response.");

            return new PaymentRedirect(invoice.InvoiceId, invoice.PageUrl);
        }
        catch (HttpRequestException ex)
        {
            throw new PaymentProviderException("Monobank invoice creation failed.", ex);
        }
    }

    private sealed record MonobankInvoiceResponse(string? InvoiceId, string? PageUrl);
}

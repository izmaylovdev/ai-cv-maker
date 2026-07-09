namespace CvApi.Features.Billing;

/// <summary>
/// Payment-provider configuration for balance top-ups (US-BILL-1), bound to
/// <c>Billing:Payments</c>. Real secrets come from .NET User Secrets locally and
/// env vars in deployment — never from appsettings files.
/// </summary>
public class PaymentsOptions
{
    public const string SectionName = "Billing:Payments";

    /// <summary>
    /// When true, both payment channels are replaced by fake implementations
    /// that redirect to the local <c>/api/billing/fake-pay/*</c> pages
    /// (F-BILL-1.9). Default false; enabled in appsettings.Development.json.
    /// </summary>
    public bool UseFakeProviders { get; set; }

    /// <summary>Externally reachable base URL of this API (webhooks, fake-pay pages).</summary>
    public string PublicBaseUrl { get; set; } = string.Empty;

    /// <summary>Base URL of the Angular SPA (payment success/cancel redirects).</summary>
    public string SpaBaseUrl { get; set; } = string.Empty;

    public StripeOptions Stripe { get; set; } = new();
    public MonobankOptions Monobank { get; set; } = new();

    public class StripeOptions
    {
        public string SecretKey { get; set; } = string.Empty;
        public string WebhookSecret { get; set; } = string.Empty;
    }

    public class MonobankOptions
    {
        public string Token { get; set; } = string.Empty;

        /// <summary>
        /// Fixed UAH-per-USD rate used to price Monobank invoices (no live FX
        /// lookup in the MVP). The balance is still credited in USD.
        /// </summary>
        public decimal UahPerUsd { get; set; } = 42.0m;
    }
}

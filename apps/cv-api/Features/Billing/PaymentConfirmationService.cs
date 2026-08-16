using CvApi.Domain.Entities;
using CvApi.Domain.Repositories;
using CvApi.Features.Usage;

namespace CvApi.Features.Billing;

/// <summary>
/// The single confirmation code path for top-up payments (US-BILL-1,
/// F-BILL-1.5), shared by the Stripe webhook, the Monobank webhook, and the
/// dev fake-pay complete endpoint. Credits only on the Pending → Paid
/// transition; confirmations for already-terminal payments are ignored, so
/// provider retries can never double-credit and terminal statuses never regress.
///
/// The check-and-transition itself lives behind <see cref="IPaymentConfirmationStore"/>
/// so it can be made atomic (ADR-0021 decision #4). This service's job is to
/// resolve the seed allowance — which needs app settings and billing options —
/// and hand the atomic part to the store.
/// </summary>
public class PaymentConfirmationService(
    IPaymentConfirmationStore store,
    UsageService usageService)
{
    public async Task ConfirmAsync(TopUpPayment payment, bool success, CancellationToken ct = default)
    {
        if (payment.Status != TopUpStatus.Pending)
            return; // cheap pre-check; the store re-checks atomically

        // Resolved outside the transaction: it reads AppSettings and billing
        // options that are not part of the payment/account aggregate. Only
        // consulted when the user has no BillingAccount row yet — seeding from
        // zero would silently erase their default allowance (spec §1).
        var seedAllowance = success
            ? await usageService.GetEffectiveAllowanceAsync(payment.UserId)
            : 0m;

        var outcome = await store.TryConfirmAsync(payment.Id, success, seedAllowance, ct);

        // Keep the caller's in-memory copy consistent with what was committed,
        // so callers that render the payment afterwards don't show a stale status.
        if (outcome == PaymentConfirmationOutcome.Transitioned)
        {
            payment.Status = success ? TopUpStatus.Paid : TopUpStatus.Failed;
            payment.UpdatedAt = DateTime.UtcNow;
        }
    }
}

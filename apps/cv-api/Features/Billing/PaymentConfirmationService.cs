using CvApi.Domain.Entities;
using CvApi.Features.Usage;
using CvApi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace CvApi.Features.Billing;

/// <summary>
/// The single confirmation code path for top-up payments (US-BILL-1,
/// F-BILL-1.5), shared by the Stripe webhook, the Monobank webhook, and the
/// dev fake-pay complete endpoint. Credits only on the Pending → Paid
/// transition; confirmations for already-terminal payments are ignored, so
/// provider retries can never double-credit and terminal statuses never regress.
/// </summary>
public class PaymentConfirmationService(AppDbContext db, UsageService usageService)
{
    public async Task ConfirmAsync(TopUpPayment payment, bool success, CancellationToken ct = default)
    {
        if (payment.Status != TopUpStatus.Pending)
            return; // terminal — acknowledge without changing anything

        if (success)
        {
            var account = await db.BillingAccounts
                .FirstOrDefaultAsync(b => b.UserId == payment.UserId, ct);
            if (account is not null)
            {
                account.AllowanceUsd += payment.AmountUsd;
                account.UpdatedAt = DateTime.UtcNow;
            }
            else
            {
                // No BillingAccount row yet: seed it from the current effective
                // allowance. A zero-based row would silently erase the user's
                // default allowance (see spec §1, crediting rule).
                var effectiveAllowance = await usageService.GetEffectiveAllowanceAsync(payment.UserId);
                db.BillingAccounts.Add(new BillingAccount
                {
                    UserId = payment.UserId,
                    AllowanceUsd = effectiveAllowance + payment.AmountUsd,
                    UpdatedAt = DateTime.UtcNow,
                });
            }
            payment.Status = TopUpStatus.Paid;
        }
        else
        {
            payment.Status = TopUpStatus.Failed;
        }

        payment.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
    }
}

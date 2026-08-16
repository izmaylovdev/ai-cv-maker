using CvApi.Domain.Entities;
using CvApi.Domain.Repositories;
using Microsoft.EntityFrameworkCore;
using System.Data;

namespace CvApi.Infrastructure.Persistence.Repositories;

/// <summary>
/// Postgres implementation of the atomic confirmation invariant. Interim, per
/// ADR-0021 decision #3 — replaced by the Firestore transaction implementation.
///
/// Unlike the code this replaces, the status check and the two writes happen
/// inside one Serializable transaction, so concurrent provider retries cannot
/// both observe Pending.
/// </summary>
public class EfPaymentConfirmationStore(AppDbContext db) : IPaymentConfirmationStore
{
    public async Task<PaymentConfirmationOutcome> TryConfirmAsync(
        Guid paymentId,
        bool success,
        decimal seedAllowanceUsd,
        CancellationToken ct = default)
    {
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);

        var payment = await db.TopUpPayments.FirstOrDefaultAsync(p => p.Id == paymentId, ct);
        if (payment is null)
            return PaymentConfirmationOutcome.NotFound;

        if (payment.Status != TopUpStatus.Pending)
            return PaymentConfirmationOutcome.AlreadyTerminal;

        if (success)
        {
            var account = await db.BillingAccounts.FirstOrDefaultAsync(b => b.UserId == payment.UserId, ct);
            if (account is not null)
            {
                account.AllowanceUsd += payment.AmountUsd;
                account.UpdatedAt = DateTime.UtcNow;
            }
            else
            {
                db.BillingAccounts.Add(new BillingAccount
                {
                    UserId = payment.UserId,
                    AllowanceUsd = seedAllowanceUsd + payment.AmountUsd,
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
        await tx.CommitAsync(ct);
        return PaymentConfirmationOutcome.Transitioned;
    }
}

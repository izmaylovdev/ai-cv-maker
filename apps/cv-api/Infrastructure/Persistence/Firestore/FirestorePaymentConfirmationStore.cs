using CvApi.Domain.Entities;
using CvApi.Domain.Repositories;
using Google.Cloud.Firestore;

namespace CvApi.Infrastructure.Persistence.Firestore;

/// <summary>
/// Firestore implementation of the credit-exactly-once invariant (ADR-0021
/// decision #4).
///
/// The status read, the Pending → Paid/Failed flip and the balance write all
/// happen inside one Firestore transaction, so two provider retries arriving
/// together cannot both observe Pending and both credit. Firestore transactions
/// are optimistic: if another writer touches a document this transaction read,
/// the commit fails and <c>RunTransactionAsync</c> re-runs the callback from
/// scratch — which is why the callback re-reads everything and holds no state
/// across attempts.
///
/// Firestore also requires every read in a transaction to precede every write,
/// so the billing account is fetched before the payment is written even though
/// the payment is the document the decision hinges on.
/// </summary>
public class FirestorePaymentConfirmationStore(FirestoreDb db) : IPaymentConfirmationStore
{
    public Task<PaymentConfirmationOutcome> TryConfirmAsync(
        Guid paymentId,
        bool success,
        decimal seedAllowanceUsd,
        CancellationToken ct = default) =>
        db.RunTransactionAsync(async transaction =>
        {
            var paymentRef = FirestorePaths.TopUpPayments(db)
                .Document(FirestoreValues.FromGuid(paymentId));

            var paymentSnapshot = await transaction.GetSnapshotAsync(paymentRef, ct);
            if (!paymentSnapshot.Exists)
                return PaymentConfirmationOutcome.NotFound;

            var payment = FirestoreMappers.ToTopUpPayment(paymentSnapshot);
            if (payment.Status != TopUpStatus.Pending)
                return PaymentConfirmationOutcome.AlreadyTerminal;

            var now = DateTime.UtcNow;

            if (success)
            {
                var accountRef = FirestorePaths.BillingAccount(db, payment.UserId);
                var accountSnapshot = await transaction.GetSnapshotAsync(accountRef, ct);

                var account = accountSnapshot.Exists
                    ? FirestoreMappers.ToBillingAccount(accountSnapshot)
                    // No account yet: seed from the caller's effective allowance
                    // rather than zero, which would silently erase the user's
                    // default allowance.
                    : new BillingAccount { UserId = payment.UserId, AllowanceUsd = seedAllowanceUsd };

                account.AllowanceUsd += payment.AmountUsd;
                account.UpdatedAt = now;
                transaction.Set(accountRef, FirestoreMappers.FromBillingAccount(account));

                payment.Status = TopUpStatus.Paid;
            }
            else
            {
                payment.Status = TopUpStatus.Failed;
            }

            payment.UpdatedAt = now;
            transaction.Set(paymentRef, FirestoreMappers.FromTopUpPayment(payment));

            return PaymentConfirmationOutcome.Transitioned;
        }, cancellationToken: ct);
}

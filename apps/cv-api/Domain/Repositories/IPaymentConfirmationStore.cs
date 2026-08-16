namespace CvApi.Domain.Repositories;

/// <summary>Outcome of an attempted payment confirmation.</summary>
public enum PaymentConfirmationOutcome
{
    /// <summary>This call performed the Pending → Paid/Failed transition.</summary>
    Transitioned,

    /// <summary>The payment was already terminal; nothing changed (a provider retry).</summary>
    AlreadyTerminal,

    /// <summary>No payment with that id exists.</summary>
    NotFound,
}

/// <summary>
/// The atomic half of top-up confirmation (ADR-0021 decision #4).
///
/// This is deliberately *not* expressed as generic CRUD. The invariant that
/// matters — a Pending payment flips to Paid and credits the balance exactly
/// once, no matter how many times a provider retries the webhook — has to hold
/// across the status read, the status write and the balance write together.
/// Exposing get/update separately would let a caller reproduce the race that
/// this interface exists to prevent.
///
/// Note this is *stronger* than the behaviour it replaces: the EF Core version
/// read the payment, checked Status in application code and saved, with no
/// transaction and no concurrency token, so two concurrent confirmations could
/// both observe Pending and both credit. Implementations of this interface must
/// make the check-and-transition atomic.
/// </summary>
public interface IPaymentConfirmationStore
{
    /// <summary>
    /// Atomically confirm <paramref name="paymentId"/>.
    ///
    /// On <paramref name="success"/>, credits the payment amount to the user's
    /// BillingAccount, creating that account seeded from
    /// <paramref name="seedAllowanceUsd"/> when none exists — a zero-based row
    /// would silently erase the user's default allowance.
    ///
    /// <paramref name="seedAllowanceUsd"/> is resolved by the caller before the
    /// transaction opens, because computing it reads app settings and billing
    /// options that are not part of this aggregate. It is only consulted on the
    /// create path.
    /// </summary>
    Task<PaymentConfirmationOutcome> TryConfirmAsync(
        Guid paymentId,
        bool success,
        decimal seedAllowanceUsd,
        CancellationToken ct = default);
}

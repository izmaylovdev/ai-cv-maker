using Xunit;

namespace CvApi.Tests;

/// <summary>
/// Dedicated coverage for the credit-exactly-once invariant (ADR-0021
/// decision #4), written before the Firestore cutover rather than after.
///
/// These tests target <see cref="Domain.Repositories.IPaymentConfirmationStore"/>
/// semantics directly, so the same suite can be pointed at the Firestore
/// implementation to prove the transaction preserves the behaviour. It now is:
/// the scenarios themselves live in <see cref="PaymentConfirmationContract"/>,
/// this class runs them against the in-memory fake, and
/// <see cref="FirestorePaymentConfirmationTests"/> runs the identical set
/// against a real Firestore database on the emulator. Anything asserted there
/// is a contract every implementation must satisfy.
/// </summary>
public class PaymentConfirmationTests
{
    private static PaymentConfirmationContract Contract() =>
        new(new InMemoryPaymentConfirmationBackend());

    // -------------------------------------------------------------------------
    // The core invariant
    // -------------------------------------------------------------------------

    [Fact]
    public Task Confirm_Success_CreditsExactlyOnce_AndMarksPaid() =>
        Contract().Confirm_Success_CreditsExactlyOnce_AndMarksPaid();

    [Fact]
    public Task Confirm_RepeatedSuccess_DoesNotDoubleCredit() =>
        Contract().Confirm_RepeatedSuccess_DoesNotDoubleCredit();

    [Fact]
    public Task Store_SecondConfirmReportsAlreadyTerminal_AndLeavesBalanceUntouched() =>
        Contract().Store_SecondConfirmReportsAlreadyTerminal_AndLeavesBalanceUntouched();

    // -------------------------------------------------------------------------
    // Seeding a first-time account
    // -------------------------------------------------------------------------

    [Fact]
    public Task Confirm_NoBillingAccount_SeedsFromEffectiveAllowance_NotFromZero() =>
        Contract().Confirm_NoBillingAccount_SeedsFromEffectiveAllowance_NotFromZero();

    // -------------------------------------------------------------------------
    // Terminal statuses never regress
    // -------------------------------------------------------------------------

    [Fact]
    public Task Confirm_Failure_MarksFailed_AndCreditsNothing() =>
        Contract().Confirm_Failure_MarksFailed_AndCreditsNothing();

    [Fact]
    public Task Confirm_PaidThenFailure_DoesNotRegressStatusOrBalance() =>
        Contract().Confirm_PaidThenFailure_DoesNotRegressStatusOrBalance();

    [Fact]
    public Task Confirm_FailedThenSuccess_DoesNotCredit() =>
        Contract().Confirm_FailedThenSuccess_DoesNotCredit();

    // -------------------------------------------------------------------------
    // Isolation and unknown payments
    // -------------------------------------------------------------------------

    [Fact]
    public Task Confirm_CreditsOnlyThePayingUser() =>
        Contract().Confirm_CreditsOnlyThePayingUser();

    [Fact]
    public Task Store_UnknownPayment_ReportsNotFound() =>
        Contract().Store_UnknownPayment_ReportsNotFound();

    [Theory]
    [InlineData(5)]
    [InlineData(10)]
    [InlineData(20)]
    public Task Confirm_CreditsTheExactAmount(int amount) =>
        Contract().Confirm_CreditsTheExactAmount(amount);
}

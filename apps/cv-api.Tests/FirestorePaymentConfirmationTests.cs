namespace CvApi.Tests;

/// <summary>
/// The <see cref="PaymentConfirmationTests"/> scenarios run against
/// <see cref="Infrastructure.Persistence.Firestore.FirestorePaymentConfirmationStore"/>
/// on a real Firestore emulator — the acceptance gate for ADR-0021 decision #4.
///
/// Each test gets its own emulator project, so the whole-collection assertions
/// ("no billing account was created anywhere") mean what they say. Skipped when
/// no emulator is configured; see <see cref="FirestoreEmulator"/>.
/// </summary>
public class FirestorePaymentConfirmationTests
{
    private static PaymentConfirmationContract Contract() =>
        new(new FirestorePaymentConfirmationBackend());

    [FirestoreEmulatorFact]
    public Task Confirm_Success_CreditsExactlyOnce_AndMarksPaid() =>
        Contract().Confirm_Success_CreditsExactlyOnce_AndMarksPaid();

    [FirestoreEmulatorFact]
    public Task Confirm_RepeatedSuccess_DoesNotDoubleCredit() =>
        Contract().Confirm_RepeatedSuccess_DoesNotDoubleCredit();

    [FirestoreEmulatorFact]
    public Task Store_SecondConfirmReportsAlreadyTerminal_AndLeavesBalanceUntouched() =>
        Contract().Store_SecondConfirmReportsAlreadyTerminal_AndLeavesBalanceUntouched();

    [FirestoreEmulatorFact]
    public Task Confirm_NoBillingAccount_SeedsFromEffectiveAllowance_NotFromZero() =>
        Contract().Confirm_NoBillingAccount_SeedsFromEffectiveAllowance_NotFromZero();

    [FirestoreEmulatorFact]
    public Task Confirm_Failure_MarksFailed_AndCreditsNothing() =>
        Contract().Confirm_Failure_MarksFailed_AndCreditsNothing();

    [FirestoreEmulatorFact]
    public Task Confirm_PaidThenFailure_DoesNotRegressStatusOrBalance() =>
        Contract().Confirm_PaidThenFailure_DoesNotRegressStatusOrBalance();

    [FirestoreEmulatorFact]
    public Task Confirm_FailedThenSuccess_DoesNotCredit() =>
        Contract().Confirm_FailedThenSuccess_DoesNotCredit();

    [FirestoreEmulatorFact]
    public Task Confirm_CreditsOnlyThePayingUser() =>
        Contract().Confirm_CreditsOnlyThePayingUser();

    [FirestoreEmulatorFact]
    public Task Store_UnknownPayment_ReportsNotFound() =>
        Contract().Store_UnknownPayment_ReportsNotFound();

    [FirestoreEmulatorTheory]
    [InlineData(5)]
    [InlineData(10)]
    [InlineData(20)]
    public Task Confirm_CreditsTheExactAmount(int amount) =>
        Contract().Confirm_CreditsTheExactAmount(amount);
}

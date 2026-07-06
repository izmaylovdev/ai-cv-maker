using CvApi.Domain.Entities;
using CvApi.Features.Billing.Channels;
using CvApi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace CvApi.Features.Billing;

/// <summary>
/// Starts balance top-ups and reads per-user top-up history (US-BILL-1).
/// The payment channel is chosen from the user's stored country by
/// <see cref="PaymentChannelResolver"/>.
/// </summary>
public class TopUpService(AppDbContext db, PaymentChannelResolver channelResolver)
{
    /// <summary>Fixed top-up amounts (F-BILL-1.1): $5, $10, $20.</summary>
    public static readonly decimal[] AllowedAmounts = [5m, 10m, 20m];

    /// <summary>
    /// Creates a Pending <see cref="TopUpPayment"/>, asks the resolved channel
    /// for the provider-side payment, and stores its external id. Throws
    /// <see cref="PaymentProviderException"/> (→ 502) when the provider call
    /// fails; the payment is then marked Failed.
    /// </summary>
    public async Task<TopUpCreatedDto> StartAsync(
        Guid userId, decimal amountUsd, string country, CancellationToken ct)
    {
        var channel = channelResolver.Resolve(country);
        var payment = new TopUpPayment
        {
            UserId = userId,
            AmountUsd = amountUsd,
            Channel = channel.Name,
        };
        db.TopUpPayments.Add(payment);
        await db.SaveChangesAsync(ct);

        try
        {
            var redirect = await channel.CreatePaymentAsync(payment, ct);
            payment.ExternalId = redirect.ExternalId;
            payment.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(ct);
            return new TopUpCreatedDto(payment.Id, channel.Name, redirect.RedirectUrl);
        }
        catch (PaymentProviderException)
        {
            payment.Status = TopUpStatus.Failed;
            payment.UpdatedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(ct);
            throw;
        }
    }

    /// <summary>Top-up history, newest first (F-BILL-1.7).</summary>
    public async Task<List<TopUpHistoryItemDto>> GetHistoryAsync(Guid userId)
        => await db.TopUpPayments
            .Where(p => p.UserId == userId)
            .OrderByDescending(p => p.CreatedAt)
            .Select(p => new TopUpHistoryItemDto(p.Id, p.AmountUsd, p.Channel, p.Status, p.CreatedAt))
            .ToListAsync();
}

public record TopUpRequest(decimal AmountUsd);
public record UpdateCountryRequest(string? Country);
public record TopUpCreatedDto(Guid PaymentId, string Channel, string RedirectUrl);
public record TopUpHistoryItemDto(Guid Id, decimal AmountUsd, string Channel, string Status, DateTime CreatedAt);

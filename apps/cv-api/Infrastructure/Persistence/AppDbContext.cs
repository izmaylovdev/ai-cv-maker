using System.Text.Json;
using CvApi.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;

namespace CvApi.Infrastructure.Persistence;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<Profile> Profiles => Set<Profile>();
    public DbSet<GeneratedCv> GeneratedCvs => Set<GeneratedCv>();
    public DbSet<LlmUsage> LlmUsages => Set<LlmUsage>();
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();
    public DbSet<AppSetting> AppSettings => Set<AppSetting>();
    public DbSet<BillingAccount> BillingAccounts => Set<BillingAccount>();
    public DbSet<TopUpPayment> TopUpPayments => Set<TopUpPayment>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<User>(e =>
        {
            e.HasKey(u => u.Id);
            e.HasIndex(u => u.Email).IsUnique();
            e.HasIndex(u => u.GoogleId).IsUnique().HasFilter("\"GoogleId\" IS NOT NULL");
            e.Property(u => u.Email).IsRequired().HasMaxLength(256);
            e.Property(u => u.GoogleId).HasMaxLength(128);
            e.Property(u => u.Country).HasMaxLength(2);
            e.HasMany(u => u.Profiles)
                .WithOne(p => p.User)
                .HasForeignKey(p => p.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        // Profile.Document is stored as a jsonb column (ADR-0013). A value
        // comparer keyed on the serialized JSON lets EF detect edits to the
        // mutable document graph.
        var docComparer = new ValueComparer<ProfileDocument>(
            (a, b) => JsonSerializer.Serialize(a, ProfileDocumentJson.Options)
                      == JsonSerializer.Serialize(b, ProfileDocumentJson.Options),
            v => JsonSerializer.Serialize(v, ProfileDocumentJson.Options).GetHashCode(),
            v => JsonSerializer.Deserialize<ProfileDocument>(
                     JsonSerializer.Serialize(v, ProfileDocumentJson.Options),
                     ProfileDocumentJson.Options)!);

        modelBuilder.Entity<Profile>(e =>
        {
            e.HasKey(p => p.Id);
            e.Property(p => p.Name).HasMaxLength(200).HasDefaultValue("My Profile");
            e.Property(p => p.Document)
                .HasColumnType("jsonb")
                .HasConversion(
                    v => JsonSerializer.Serialize(v, ProfileDocumentJson.Options),
                    v => JsonSerializer.Deserialize<ProfileDocument>(v, ProfileDocumentJson.Options)
                         ?? ProfileDocument.Empty())
                .Metadata.SetValueComparer(docComparer);
        });

        modelBuilder.Entity<GeneratedCv>(e =>
        {
            e.HasKey(g => g.Id);
            e.Property(g => g.FullName).HasMaxLength(200);
            e.Property(g => g.Title).HasMaxLength(200);
            e.Property(g => g.Location).HasMaxLength(200);
            e.Property(g => g.ContactEmail).HasMaxLength(256);
            e.Property(g => g.ContactPhone).HasMaxLength(50);
            e.HasOne(g => g.Profile)
                .WithMany(p => p.GeneratedCvs)
                .HasForeignKey(g => g.ProfileId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<LlmUsage>(e =>
        {
            e.HasKey(u => u.Id);
            e.Property(u => u.Operation).HasMaxLength(100).IsRequired();
            e.Property(u => u.ModelName).HasMaxLength(100).IsRequired();
            e.HasIndex(u => u.UserId);
            e.HasIndex(u => u.CreatedAt);
        });

        modelBuilder.Entity<AppSetting>(e =>
        {
            e.HasKey(s => s.Key);
            e.Property(s => s.Key).HasMaxLength(100);
            e.Property(s => s.Value).HasMaxLength(512).IsRequired();
        });

        modelBuilder.Entity<BillingAccount>(e =>
        {
            e.HasKey(b => b.Id);
            e.HasIndex(b => b.UserId).IsUnique();
            e.Property(b => b.AllowanceUsd).HasColumnType("decimal(18,6)");
            e.Property(b => b.Currency).IsRequired().HasMaxLength(3);
        });

        modelBuilder.Entity<TopUpPayment>(e =>
        {
            e.HasKey(p => p.Id);
            e.HasIndex(p => p.UserId);
            // Postgres unique indexes ignore NULLs, so payments whose provider
            // call failed before an id was assigned don't collide.
            e.HasIndex(p => p.ExternalId).IsUnique();
            e.Property(p => p.AmountUsd).HasColumnType("decimal(18,6)");
            e.Property(p => p.Channel).IsRequired().HasMaxLength(32);
            e.Property(p => p.Status).IsRequired().HasMaxLength(16);
            e.Property(p => p.ExternalId).HasMaxLength(256);
            e.HasOne<User>()
                .WithMany()
                .HasForeignKey(p => p.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<RefreshToken>(e =>
        {
            e.HasKey(r => r.Id);
            e.HasIndex(r => r.Token).IsUnique();
            e.Property(r => r.Token).IsRequired().HasMaxLength(128);
            e.HasOne(r => r.User)
                .WithMany()
                .HasForeignKey(r => r.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });
    }
}

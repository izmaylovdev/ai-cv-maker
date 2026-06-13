using CvApi.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace CvApi.Infrastructure.Persistence;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<Profile> Profiles => Set<Profile>();
    public DbSet<WorkExperience> WorkExperiences => Set<WorkExperience>();
    public DbSet<Education> Educations => Set<Education>();
    public DbSet<Skill> Skills => Set<Skill>();
    public DbSet<GeneratedCv> GeneratedCvs => Set<GeneratedCv>();
    public DbSet<RequestSpan> RequestSpans => Set<RequestSpan>();
    public DbSet<LlmUsage> LlmUsages => Set<LlmUsage>();
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();
    public DbSet<AppSetting> AppSettings => Set<AppSetting>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<User>(e =>
        {
            e.HasKey(u => u.Id);
            e.HasIndex(u => u.Email).IsUnique();
            e.HasIndex(u => u.GoogleId).IsUnique().HasFilter("\"GoogleId\" IS NOT NULL");
            e.Property(u => u.Email).IsRequired().HasMaxLength(256);
            e.Property(u => u.GoogleId).HasMaxLength(128);
            e.HasMany(u => u.Profiles)
                .WithOne(p => p.User)
                .HasForeignKey(p => p.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<Profile>(e =>
        {
            e.HasKey(p => p.Id);
            e.Property(p => p.Name).HasMaxLength(200).HasDefaultValue("My Profile");
            e.Property(p => p.SectionOrder).HasMaxLength(200).HasDefaultValue("workExperiences,educations,skills");
            e.Property(p => p.FullName).HasMaxLength(200);
            e.Property(p => p.Title).HasMaxLength(200);
            e.Property(p => p.Location).HasMaxLength(200);
            e.Property(p => p.ContactEmail).HasMaxLength(256);
            e.Property(p => p.ContactPhone).HasMaxLength(50);
            e.HasMany(p => p.WorkExperiences)
                .WithOne(w => w.Profile)
                .HasForeignKey(w => w.ProfileId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasMany(p => p.Educations)
                .WithOne(ed => ed.Profile)
                .HasForeignKey(ed => ed.ProfileId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasMany(p => p.Skills)
                .WithOne(s => s.Profile)
                .HasForeignKey(s => s.ProfileId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<WorkExperience>(e =>
        {
            e.HasKey(w => w.Id);
            e.Property(w => w.Company).HasMaxLength(200);
            e.Property(w => w.Role).HasMaxLength(200);
        });

        modelBuilder.Entity<Education>(e =>
        {
            e.HasKey(ed => ed.Id);
            e.Property(ed => ed.Institution).HasMaxLength(200);
            e.Property(ed => ed.Degree).HasMaxLength(200);
            e.Property(ed => ed.Field).HasMaxLength(200);
        });

        modelBuilder.Entity<Skill>(e =>
        {
            e.HasKey(s => s.Id);
            e.Property(s => s.Name).HasMaxLength(100);
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

        modelBuilder.Entity<RequestSpan>(e =>
        {
            e.HasKey(s => s.Id);
            e.Property(s => s.Service).HasMaxLength(20).IsRequired();
            e.Property(s => s.SpanKind).HasMaxLength(10).IsRequired();
            e.Property(s => s.Operation).HasMaxLength(300).IsRequired();
            e.HasIndex(s => s.TraceId);
            e.HasIndex(s => s.StartedAt);
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

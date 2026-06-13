using CvApi.Domain.Entities;
using CvApi.Features.Admin;
using CvApi.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace CvApi.Tests;

public class AdminUsersServiceTests
{
    private static AppDbContext CreateDb()
    {
        var opts = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new AppDbContext(opts);
    }

    [Fact]
    public async Task GetUsersAsync_ProjectsFieldsAndProfileCount()
    {
        await using var db = CreateDb();
        var user = new User { Email = "jane@example.com", GoogleId = "g-1" };
        user.Profiles.Add(new Profile { UserId = user.Id, Name = "A" });
        user.Profiles.Add(new Profile { UserId = user.Id, Name = "B" });
        db.Users.Add(user);
        db.Users.Add(new User { Email = "noprofiles@example.com" });
        await db.SaveChangesAsync();

        var rows = await new AdminUsersService(db).GetUsersAsync();

        var jane = rows.Single(r => r.Email == "jane@example.com");
        Assert.Equal(user.Id, jane.Id);
        Assert.Equal("g-1", jane.GoogleId);
        Assert.Equal(2, jane.ProfileCount);

        var solo = rows.Single(r => r.Email == "noprofiles@example.com");
        Assert.Null(solo.GoogleId);
        Assert.Equal(0, solo.ProfileCount);
    }

    [Fact]
    public async Task GetUsersAsync_OrdersByCreatedAtDescending()
    {
        await using var db = CreateDb();
        db.Users.Add(new User { Email = "old@example.com", CreatedAt = new DateTime(2024, 1, 1, 0, 0, 0, DateTimeKind.Utc) });
        db.Users.Add(new User { Email = "new@example.com", CreatedAt = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc) });
        await db.SaveChangesAsync();

        var rows = await new AdminUsersService(db).GetUsersAsync();

        Assert.Equal("new@example.com", rows[0].Email);
        Assert.Equal("old@example.com", rows[1].Email);
    }
}

using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace CvApi.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddCacheTokensToLlmUsage : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "CacheReadTokens",
                table: "LlmUsages",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "CacheWriteTokens",
                table: "LlmUsages",
                type: "integer",
                nullable: false,
                defaultValue: 0);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CacheReadTokens",
                table: "LlmUsages");

            migrationBuilder.DropColumn(
                name: "CacheWriteTokens",
                table: "LlmUsages");
        }
    }
}

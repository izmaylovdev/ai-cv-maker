using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace CvApi.Migrations
{
    /// <inheritdoc />
    public partial class AddLlmUsageTable : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "LlmUsages",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: true),
                    Operation = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    PromptTokens = table.Column<int>(type: "integer", nullable: false),
                    CompletionTokens = table.Column<int>(type: "integer", nullable: false),
                    ModelName = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_LlmUsages", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_LlmUsages_CreatedAt",
                table: "LlmUsages",
                column: "CreatedAt");

            migrationBuilder.CreateIndex(
                name: "IX_LlmUsages_UserId",
                table: "LlmUsages",
                column: "UserId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "LlmUsages");
        }
    }
}

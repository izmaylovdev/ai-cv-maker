using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace CvApi.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddBillingAccounts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "BillingAccounts",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    AllowanceUsd = table.Column<decimal>(type: "numeric(18,6)", nullable: false),
                    Currency = table.Column<string>(type: "character varying(3)", maxLength: 3, nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BillingAccounts", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_BillingAccounts_UserId",
                table: "BillingAccounts",
                column: "UserId",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "BillingAccounts");
        }
    }
}

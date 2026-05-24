using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace CvApi.Migrations
{
    /// <inheritdoc />
    public partial class AddRequestSpans : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "RequestSpans",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TraceId = table.Column<Guid>(type: "uuid", nullable: false),
                    Service = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    SpanKind = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    Operation = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    StatusCode = table.Column<int>(type: "integer", nullable: true),
                    IsError = table.Column<bool>(type: "boolean", nullable: false),
                    DurationMs = table.Column<int>(type: "integer", nullable: false),
                    StartedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RequestSpans", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_RequestSpans_StartedAt",
                table: "RequestSpans",
                column: "StartedAt");

            migrationBuilder.CreateIndex(
                name: "IX_RequestSpans_TraceId",
                table: "RequestSpans",
                column: "TraceId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "RequestSpans");
        }
    }
}

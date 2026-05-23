using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace cv_api.Migrations
{
    /// <inheritdoc />
    public partial class AddProfileContacts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ContactEmail",
                table: "Profiles",
                type: "character varying(256)",
                maxLength: 256,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ContactPhone",
                table: "Profiles",
                type: "character varying(50)",
                maxLength: 50,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ContactEmail",
                table: "Profiles");

            migrationBuilder.DropColumn(
                name: "ContactPhone",
                table: "Profiles");
        }
    }
}

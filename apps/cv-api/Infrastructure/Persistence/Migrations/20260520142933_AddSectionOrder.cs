using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace CvApi.Migrations
{
    /// <inheritdoc />
    public partial class AddSectionOrder : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "SectionOrder",
                table: "Profiles",
                type: "character varying(200)",
                maxLength: 200,
                nullable: false,
                defaultValue: "workExperiences,educations,skills");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "SectionOrder",
                table: "Profiles");
        }
    }
}

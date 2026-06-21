using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace CvApi.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class ProfileDocumentModel : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // ADR-0013: move the structured Profile + child tables into a single
            // section-based document (jsonb). Add the column, backfill from the
            // existing rows, then drop the legacy schema.
            migrationBuilder.AddColumn<string>(
                name: "Document",
                table: "Profiles",
                type: "jsonb",
                nullable: true);

            migrationBuilder.Sql(BackfillSql);

            migrationBuilder.AlterColumn<string>(
                name: "Document",
                table: "Profiles",
                type: "jsonb",
                nullable: false,
                oldClrType: typeof(string),
                oldType: "jsonb",
                oldNullable: true);

            migrationBuilder.DropTable(name: "Educations");
            migrationBuilder.DropTable(name: "Skills");
            migrationBuilder.DropTable(name: "WorkExperiences");

            migrationBuilder.DropColumn(name: "ContactEmail", table: "Profiles");
            migrationBuilder.DropColumn(name: "ContactPhone", table: "Profiles");
            migrationBuilder.DropColumn(name: "FullName", table: "Profiles");
            migrationBuilder.DropColumn(name: "Location", table: "Profiles");
            migrationBuilder.DropColumn(name: "Overview", table: "Profiles");
            migrationBuilder.DropColumn(name: "SectionOrder", table: "Profiles");
            migrationBuilder.DropColumn(name: "Title", table: "Profiles");
        }

        // Composes the jsonb document from the legacy columns and child rows:
        // overview → a "Summary" free-form section; work/education → timeline
        // sections (newest first); skills → a list section; contacts → header.
        private const string BackfillSql = """
            UPDATE "Profiles" p SET "Document" = jsonb_build_object(
              'header', jsonb_build_object(
                'fullName', COALESCE(p."FullName", ''),
                'title',    COALESCE(p."Title", ''),
                'email',    COALESCE(p."ContactEmail", ''),
                'phone',    COALESCE(p."ContactPhone", ''),
                'location', COALESCE(p."Location", '')
              ),
              'sections',
                (CASE WHEN COALESCE(p."Overview", '') <> '' THEN jsonb_build_array(jsonb_build_object(
                    'id', gen_random_uuid()::text, 'template', 'free-form', 'heading', 'Summary', 'body', p."Overview"
                 )) ELSE '[]'::jsonb END)
              || COALESCE((SELECT jsonb_build_array(jsonb_build_object(
                    'id', gen_random_uuid()::text, 'template', 'timeline', 'heading', 'Work Experience',
                    'items', jsonb_agg(jsonb_build_object(
                       'id', gen_random_uuid()::text,
                       'title', w."Role" || CASE WHEN COALESCE(w."Company", '') <> '' THEN ' · ' || w."Company" ELSE '' END,
                       'dates', to_char(w."StartDate", 'Mon YYYY') || ' – ' || COALESCE(to_char(w."EndDate", 'Mon YYYY'), 'Present'),
                       'description', COALESCE(w."Description", '')
                    ) ORDER BY w."EndDate" DESC NULLS FIRST, w."StartDate" DESC)))
                  FROM "WorkExperiences" w WHERE w."ProfileId" = p."Id" HAVING count(*) > 0), '[]'::jsonb)
              || COALESCE((SELECT jsonb_build_array(jsonb_build_object(
                    'id', gen_random_uuid()::text, 'template', 'timeline', 'heading', 'Education',
                    'items', jsonb_agg(jsonb_build_object(
                       'id', gen_random_uuid()::text,
                       'title', e."Degree"
                                || CASE WHEN COALESCE(e."Field", '') <> '' THEN ' in ' || e."Field" ELSE '' END
                                || CASE WHEN COALESCE(e."Institution", '') <> '' THEN ' · ' || e."Institution" ELSE '' END,
                       'dates', e."StartYear"::text || ' – ' || COALESCE(e."EndYear"::text, 'Present'),
                       'description', ''
                    ) ORDER BY e."EndYear" DESC NULLS FIRST, e."StartYear" DESC)))
                  FROM "Educations" e WHERE e."ProfileId" = p."Id" HAVING count(*) > 0), '[]'::jsonb)
              || COALESCE((SELECT jsonb_build_array(jsonb_build_object(
                    'id', gen_random_uuid()::text, 'template', 'list', 'heading', 'Skills',
                    'items', jsonb_agg(jsonb_build_object('id', gen_random_uuid()::text, 'text', s."Name") ORDER BY s."Order")))
                  FROM "Skills" s WHERE s."ProfileId" = p."Id" HAVING count(*) > 0), '[]'::jsonb)
            );
            UPDATE "Profiles" SET "Document" = '{"header":{"fullName":"","title":"","email":"","phone":"","location":""},"sections":[]}'::jsonb
            WHERE "Document" IS NULL;
            """;

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Document",
                table: "Profiles");

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

            migrationBuilder.AddColumn<string>(
                name: "FullName",
                table: "Profiles",
                type: "character varying(200)",
                maxLength: 200,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "Location",
                table: "Profiles",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Overview",
                table: "Profiles",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "SectionOrder",
                table: "Profiles",
                type: "character varying(200)",
                maxLength: 200,
                nullable: false,
                defaultValue: "workExperiences,educations,skills");

            migrationBuilder.AddColumn<string>(
                name: "Title",
                table: "Profiles",
                type: "character varying(200)",
                maxLength: 200,
                nullable: false,
                defaultValue: "");

            migrationBuilder.CreateTable(
                name: "Educations",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ProfileId = table.Column<Guid>(type: "uuid", nullable: false),
                    Degree = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    EndYear = table.Column<int>(type: "integer", nullable: true),
                    Field = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Institution = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    StartYear = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Educations", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Educations_Profiles_ProfileId",
                        column: x => x.ProfileId,
                        principalTable: "Profiles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Skills",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ProfileId = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Order = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Skills", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Skills_Profiles_ProfileId",
                        column: x => x.ProfileId,
                        principalTable: "Profiles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "WorkExperiences",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ProfileId = table.Column<Guid>(type: "uuid", nullable: false),
                    Company = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Description = table.Column<string>(type: "text", nullable: false),
                    EndDate = table.Column<DateOnly>(type: "date", nullable: true),
                    Role = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    StartDate = table.Column<DateOnly>(type: "date", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WorkExperiences", x => x.Id);
                    table.ForeignKey(
                        name: "FK_WorkExperiences_Profiles_ProfileId",
                        column: x => x.ProfileId,
                        principalTable: "Profiles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Educations_ProfileId",
                table: "Educations",
                column: "ProfileId");

            migrationBuilder.CreateIndex(
                name: "IX_Skills_ProfileId",
                table: "Skills",
                column: "ProfileId");

            migrationBuilder.CreateIndex(
                name: "IX_WorkExperiences_ProfileId",
                table: "WorkExperiences",
                column: "ProfileId");
        }
    }
}

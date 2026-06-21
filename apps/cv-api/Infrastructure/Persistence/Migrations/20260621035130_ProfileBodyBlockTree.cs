using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace CvApi.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class ProfileBodyBlockTree : Migration
    {
        // ADR-0014 (amends ADR-0013): the Profile.Document jsonb shape changes from
        // section-based `{ header, sections[] }` to the block tree `{ header, body }`,
        // where `body` is a `root` node whose children are `section` nodes (§9.2/§9.5).
        // The column type (jsonb) is unchanged, so there is no schema DDL — only a
        // one-way data backfill (rollback = restore from backup, ADR-0003).

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(BackfillUpSql);
        }

        // Maps each legacy document in place. For every old section we emit a
        // `section` node (heading → attrs.heading) and translate its template:
        //   free-form  → its `body` text becomes a `paragraph` of one `text` node
        //   list       → `items[].text` become `list` → `listItem` → paragraph/text
        //   chip-list  → `items[].text` become `chips` → `chip` nodes
        //   timeline   → `items[]` become `timeline` → `entry` (title/dates → attrs,
        //                description → a `paragraph` of one `text` node)
        // Unknown templates degrade to a heading-only section (empty children).
        // Ids are freshly generated; node order follows array order (= document order).
        private const string BackfillUpSql = """
            CREATE OR REPLACE FUNCTION pg_temp.applysy_node(p_type text, p_text text)
            RETURNS jsonb LANGUAGE sql AS $$
              SELECT jsonb_build_object(
                'type', p_type,
                'id', gen_random_uuid()::text,
                'attrs', jsonb_build_object('text', COALESCE(p_text, '')),
                'children', '[]'::jsonb)
            $$;

            -- A `paragraph` wrapping a single `text` node (free-form / descriptions).
            CREATE OR REPLACE FUNCTION pg_temp.applysy_paragraph(p_text text)
            RETURNS jsonb LANGUAGE sql AS $$
              SELECT jsonb_build_object(
                'type', 'paragraph',
                'id', gen_random_uuid()::text,
                'attrs', '{}'::jsonb,
                'children', jsonb_build_array(pg_temp.applysy_node('text', p_text)))
            $$;

            -- Translate one legacy section object into a `section` block node.
            CREATE OR REPLACE FUNCTION pg_temp.applysy_section(sec jsonb)
            RETURNS jsonb LANGUAGE plpgsql AS $$
            DECLARE
              tmpl text := sec->>'template';
              children jsonb := '[]'::jsonb;
              flow jsonb;
              item jsonb;
              entries jsonb := '[]'::jsonb;
              listitems jsonb := '[]'::jsonb;
              chips jsonb := '[]'::jsonb;
              descr jsonb;
              txt text;
            BEGIN
              IF tmpl = 'free-form' THEN
                txt := COALESCE(sec->>'body', '');
                IF txt <> '' THEN
                  children := jsonb_build_array(pg_temp.applysy_paragraph(txt));
                END IF;

              ELSIF tmpl = 'timeline' THEN
                FOR item IN SELECT * FROM jsonb_array_elements(COALESCE(sec->'items', '[]'::jsonb)) LOOP
                  descr := '[]'::jsonb;
                  IF COALESCE(item->>'description', '') <> '' THEN
                    descr := jsonb_build_array(pg_temp.applysy_paragraph(item->>'description'));
                  END IF;
                  entries := entries || jsonb_build_array(jsonb_build_object(
                    'type', 'entry',
                    'id', gen_random_uuid()::text,
                    'attrs', jsonb_build_object(
                      'title', COALESCE(item->>'title', ''),
                      'dates', COALESCE(item->>'dates', '')),
                    'children', descr));
                END LOOP;
                IF jsonb_array_length(entries) > 0 THEN
                  flow := jsonb_build_object(
                    'type', 'timeline',
                    'id', gen_random_uuid()::text,
                    'attrs', '{}'::jsonb,
                    'children', entries);
                  children := jsonb_build_array(flow);
                END IF;

              ELSIF tmpl = 'list' THEN
                FOR item IN SELECT * FROM jsonb_array_elements(COALESCE(sec->'items', '[]'::jsonb)) LOOP
                  txt := COALESCE(item->>'text', '');
                  CONTINUE WHEN txt = '';
                  listitems := listitems || jsonb_build_array(jsonb_build_object(
                    'type', 'listItem',
                    'id', gen_random_uuid()::text,
                    'attrs', '{}'::jsonb,
                    'children', jsonb_build_array(pg_temp.applysy_paragraph(txt))));
                END LOOP;
                IF jsonb_array_length(listitems) > 0 THEN
                  flow := jsonb_build_object(
                    'type', 'list',
                    'id', gen_random_uuid()::text,
                    'attrs', '{}'::jsonb,
                    'children', listitems);
                  children := jsonb_build_array(flow);
                END IF;

              ELSIF tmpl = 'chip-list' THEN
                FOR item IN SELECT * FROM jsonb_array_elements(COALESCE(sec->'items', '[]'::jsonb)) LOOP
                  txt := COALESCE(item->>'text', '');
                  CONTINUE WHEN txt = '';
                  chips := chips || jsonb_build_array(pg_temp.applysy_node('chip', txt));
                END LOOP;
                IF jsonb_array_length(chips) > 0 THEN
                  flow := jsonb_build_object(
                    'type', 'chips',
                    'id', gen_random_uuid()::text,
                    'attrs', '{}'::jsonb,
                    'children', chips);
                  children := jsonb_build_array(flow);
                END IF;
              END IF;

              RETURN jsonb_build_object(
                'type', 'section',
                'id', gen_random_uuid()::text,
                'attrs', jsonb_build_object('heading', COALESCE(sec->>'heading', '')),
                'children', children);
            END;
            $$;

            UPDATE "Profiles" p SET "Document" = jsonb_build_object(
              'header', COALESCE(p."Document"->'header', jsonb_build_object(
                'fullName', '', 'title', '', 'email', '', 'phone', '', 'location', '')),
              'body', jsonb_build_object(
                'type', 'root',
                'id', gen_random_uuid()::text,
                'attrs', '{}'::jsonb,
                'children', COALESCE((
                  SELECT jsonb_agg(pg_temp.applysy_section(sec))
                  FROM jsonb_array_elements(p."Document"->'sections') AS sec
                ), '[]'::jsonb)))
            WHERE p."Document" ? 'sections';
            """;

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // One-way migration (ADR-0003): rollback is restore-from-backup, not a
            // structural reverse. Intentionally left empty.
        }
    }
}

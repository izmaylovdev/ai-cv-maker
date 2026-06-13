-- Read-only role for admin-api's access to the MAIN cv-maker database.
-- See doc/adr/0004-admin-api-main-db-access.md.
--
-- admin-api only ever runs SELECTs against the main DB (UsersService.findAll).
-- This role enforces that at the database level so an admin-api bug or
-- compromise can never write to user data.
--
-- Run once against the main `cvmaker` database, as the admin/owner user:
--   cloud-sql-proxy <instance-connection-name> &
--   psql "host=127.0.0.1 dbname=cvmaker user=<admin>" \
--        -v readonly_password="'<strong-password>'" \
--        -f apps/admin-api/migrations/create-readonly-role.sql
--
-- The same <strong-password> goes into the admin_readonly_db_password
-- Terraform variable (stored in Secret Manager, wired to admin-api's
-- DB_PASSWORD). Re-running is safe.

-- Create the role if missing (psql variables can't be interpolated inside a
-- dollar-quoted DO block, so the password is set separately below).
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'admin_readonly') THEN
    CREATE ROLE admin_readonly LOGIN;
  END IF;
END
$$;

-- Set/reset the password (plain statement → :readonly_password is substituted).
ALTER ROLE admin_readonly LOGIN PASSWORD :readonly_password;

-- Connect + read the public schema, nothing more.
GRANT CONNECT ON DATABASE cvmaker TO admin_readonly;
GRANT USAGE ON SCHEMA public TO admin_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO admin_readonly;

-- Future tables created by EF Core migrations are readable automatically.
-- Run as the role that owns the tables (the migration/admin user) so the
-- default privileges attach to objects it creates.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO admin_readonly;

-- Belt and suspenders: no write/DDL ambient rights.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM admin_readonly;

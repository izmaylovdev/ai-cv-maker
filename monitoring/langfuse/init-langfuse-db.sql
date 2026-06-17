-- Creates the `langfuse` metadata database on the shared local Postgres
-- (ADR-0010). Mounted into the main `postgres` service by docker-compose.langfuse.yml.
-- Runs only on first cluster init (empty data volume); idempotent via \gexec.
SELECT 'CREATE DATABASE langfuse'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'langfuse')\gexec

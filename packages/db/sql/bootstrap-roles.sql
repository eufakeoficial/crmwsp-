-- Bootstrap the runtime (app) role for any environment. Run ONCE per database,
-- BEFORE migrations, connected to the target database as the migrator role
-- (or an admin that may act FOR ROLE the migrator):
--
--   psql "$ADMIN_URL" -v ON_ERROR_STOP=1 \
--     -v app_role=crmwsp_app -v app_password='...' \
--     -v migrator_role=crmwsp -f packages/db/sql/bootstrap-roles.sql
--
-- Requirements (ADR 0002): the migrator owns the database objects and may be
-- NOSUPERUSER NOBYPASSRLS (managed Postgres). The app role is LOGIN
-- NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE and must NOT be a member of
-- the migrator role (the "system_owner" RLS policies target the owner role).
-- Default privileges are declared FOR ROLE the migrator, because they only
-- apply to objects created by that role.
--
-- pgvector: migration 0009 runs CREATE EXTENSION IF NOT EXISTS vector. If the
-- migrator may not create extensions (managed Postgres), an admin must run
-- `CREATE EXTENSION IF NOT EXISTS vector;` in the target database first.
\set ON_ERROR_STOP on

SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_role') AS create_app \gset
\if :create_app
  CREATE ROLE :"app_role" LOGIN PASSWORD :'app_password' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
\endif

SELECT pg_has_role(:'app_role', :'migrator_role', 'MEMBER') AS app_is_member \gset
\if :app_is_member
  \echo 'ERROR: the app role must not be a member of the migrator role'
  \quit 3
\endif

SELECT current_database() AS dbname \gset
GRANT CONNECT ON DATABASE :"dbname" TO :"app_role";
GRANT USAGE ON SCHEMA public TO :"app_role";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"app_role";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO :"app_role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"migrator_role" IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app_role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"migrator_role" IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO :"app_role";

-- pgvector for knowledge_chunks.embedding (ADR 0002, notes on pgvector).
-- Runs before the AI tables migration because the column type depends on it.
-- On managed Postgres the migrator may lack the privilege to create
-- extensions: then an admin must run this statement once per database
-- (see packages/db/sql/bootstrap-roles.sql); here it is a no-op.
CREATE EXTENSION IF NOT EXISTS vector;

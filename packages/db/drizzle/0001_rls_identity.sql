-- Row Level Security for identity tables (ADR 0002).
--
-- The tenant is taken from the transaction-local setting `app.tenant_id`,
-- set by withTenant() via set_config('app.tenant_id', $1, true).
-- NULLIF(..., '') makes the policy evaluate to NULL (no rows) instead of
-- raising a uuid cast error when the setting is missing or was reset to ''
-- after a previous transaction on a pooled connection.
--
-- FORCE ROW LEVEL SECURITY makes the policies apply to the table owner too.
-- Only superusers and roles with BYPASSRLS skip them; the runtime role
-- (crmwsp_app) is created NOSUPERUSER NOBYPASSRLS.

-- tenants: a session only sees/modifies its own tenant row.
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenants"
  USING ("id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

-- memberships: tenant-scoped business table.
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "memberships"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

-- users: global identity, intentionally WITHOUT RLS in Phase 0.
-- Application code must reach users only through "memberships" of the
-- current tenant (join memberships -> users inside withTenant()); never list
-- or query "users" directly from tenant-facing code paths.
COMMENT ON TABLE "users" IS 'Global identity without RLS (Phase 0). Access only via memberships of the current tenant.';

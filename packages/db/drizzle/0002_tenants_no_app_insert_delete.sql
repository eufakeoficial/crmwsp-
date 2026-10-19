-- tenants: the runtime role may only read and update its own tenant row.
--
-- The previous FOR ALL policy let any role holding INSERT/DELETE grants
-- create a tenant (set app.tenant_id to a fresh uuid, then insert a row with
-- that id) or delete its own tenant. Tenant provisioning and removal are
-- system jobs run with a privileged role (BYPASSRLS/superuser), so no
-- INSERT/DELETE policy exists: with FORCE ROW LEVEL SECURITY, RLS denies those
-- commands to every other role regardless of table grants.
DROP POLICY IF EXISTS "tenant_isolation" ON "tenants";--> statement-breakpoint
CREATE POLICY "tenant_isolation_select" ON "tenants"
  FOR SELECT
  USING ("id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation_update" ON "tenants"
  FOR UPDATE
  USING ("id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

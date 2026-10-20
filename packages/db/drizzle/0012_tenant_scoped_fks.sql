-- Tenant-scoped foreign keys for the F2-A tables (ADR 0002, "FKs compuestas").
-- A plain FK is checked without RLS, so a row of tenant A could point to a
-- parent of tenant B. Composite FKs (tenant_id, x_id) -> parent(tenant_id, id)
-- make that impossible. Parents need UNIQUE (tenant_id, id): the existing
-- (tenant_id, id) btree indexes become unique (always true, id is the PK).
-- Hand-ordered: unique indexes first, then FKs. ON DELETE SET NULL lists only
-- the child column (PG 15+) so tenant_id (NOT NULL) is left untouched.
DROP INDEX "conversations_tenant_id_id_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_tenant_id_id_idx" ON "conversations" USING btree ("tenant_id","id");--> statement-breakpoint
DROP INDEX "messages_tenant_id_id_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "messages_tenant_id_id_idx" ON "messages" USING btree ("tenant_id","id");--> statement-breakpoint
DROP INDEX "knowledge_sources_tenant_id_id_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_sources_tenant_id_id_idx" ON "knowledge_sources" USING btree ("tenant_id","id");--> statement-breakpoint
DROP INDEX "ai_actions_tenant_id_id_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "ai_actions_tenant_id_id_idx" ON "ai_actions" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "knowledge_chunks" DROP CONSTRAINT "knowledge_chunks_source_id_knowledge_sources_id_fk";--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_tenant_source_fk" FOREIGN KEY ("tenant_id","source_id") REFERENCES "public"."knowledge_sources"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_approvals" DROP CONSTRAINT "action_approvals_action_id_ai_actions_id_fk";--> statement-breakpoint
ALTER TABLE "action_approvals" ADD CONSTRAINT "action_approvals_tenant_action_fk" FOREIGN KEY ("tenant_id","action_id") REFERENCES "public"."ai_actions"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_actions" DROP CONSTRAINT "ai_actions_conversation_id_conversations_id_fk";--> statement-breakpoint
ALTER TABLE "ai_actions" ADD CONSTRAINT "ai_actions_tenant_conversation_fk" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "public"."conversations"("tenant_id","id") ON DELETE SET NULL ("conversation_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_actions" DROP CONSTRAINT "ai_actions_message_id_messages_id_fk";--> statement-breakpoint
ALTER TABLE "ai_actions" ADD CONSTRAINT "ai_actions_tenant_message_fk" FOREIGN KEY ("tenant_id","message_id") REFERENCES "public"."messages"("tenant_id","id") ON DELETE SET NULL ("message_id") ON UPDATE no action;--> statement-breakpoint

-- tenant_monthly_spend: month boundaries in the tenant's timezone
-- (tenants.timezone of app.tenant_id, read under the caller's RLS); UTC when
-- there is no tenant context. Same signature, SECURITY INVOKER, fixed search_path.
CREATE OR REPLACE FUNCTION public."tenant_monthly_spend"(p_month timestamptz)
RETURNS TABLE (currency char(3), kind public."usage_kind", cost_minor numeric, quantity numeric)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
  WITH tz AS (
    SELECT COALESCE(
      (SELECT t."timezone" FROM public."tenants" t
        WHERE t."id" = NULLIF(pg_catalog.current_setting('app.tenant_id', true), '')::uuid),
      'UTC') AS name
  ), bounds AS (
    SELECT pg_catalog.date_trunc('month', p_month, tz.name) AS lo, tz.name
    FROM tz
  )
  SELECT u."currency", u."kind", pg_catalog.sum(u."cost_minor"), pg_catalog.sum(u."quantity")
  FROM public."usage_ledger" u, bounds b
  WHERE u."occurred_at" >= b.lo
    AND u."occurred_at" < pg_catalog.date_add(b.lo, interval '1 month', b.name)
  GROUP BY u."currency", u."kind"
  ORDER BY u."currency", u."kind";
$fn$;

-- Etapa 1A: bandeja "presupuestos sin respuesta".
-- quote_sends vincula cada presupuesto enviado con el mensaje saliente que lo llevó. Hasta ahora ese
-- id solo existía dentro de audit_events.diff del evento `quote.sent`, así que ninguna consulta podía
-- probar que el mensaje se entregó al proveedor. El listado une quotes -> quote_sends -> messages y
-- exige un envío confirmado. El backfill vincula un presupuesto solo cuando el mensaje del evento
-- existe en la misma empresa; el resto queda sin vínculo y se informa como cobertura desconocida.
CREATE TABLE "quote_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"quote_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "quote_sends" ADD CONSTRAINT "quote_sends_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "quote_sends_tenant_id_id_idx" ON "quote_sends" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "quote_sends_tenant_quote_unique" ON "quote_sends" USING btree ("tenant_id","quote_id");--> statement-breakpoint
ALTER TABLE "quote_sends" ADD CONSTRAINT "quote_sends_tenant_quote_fk" FOREIGN KEY ("tenant_id","quote_id") REFERENCES "public"."quotes"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_sends" ADD CONSTRAINT "quote_sends_tenant_message_fk" FOREIGN KEY ("tenant_id","message_id") REFERENCES "public"."messages"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
INSERT INTO "quote_sends" ("tenant_id", "quote_id", "message_id")
SELECT DISTINCT ON (a."tenant_id", a."entity_id") a."tenant_id", a."entity_id", m."id"
FROM "audit_events" a
JOIN "quotes" q ON q."tenant_id" = a."tenant_id" AND q."id" = a."entity_id"
JOIN "messages" m ON m."tenant_id" = a."tenant_id" AND m."id"::text = a."diff"->>'messageId'
WHERE a."entity" = 'quote' AND a."action" = 'quote.sent' AND a."entity_id" IS NOT NULL
ORDER BY a."tenant_id", a."entity_id", a."created_at" DESC
ON CONFLICT ("tenant_id", "quote_id") DO NOTHING;--> statement-breakpoint

-- «Marcar como revisada»: una fila por caso (empresa + presupuesto + envío). No altera la cotización
-- ni los recordatorios; message_id se conserva aunque el mensaje se borre.
CREATE TABLE "quote_unanswered_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"quote_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "quote_unanswered_reviews" ADD CONSTRAINT "quote_unanswered_reviews_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_unanswered_reviews" ADD CONSTRAINT "quote_unanswered_reviews_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "quote_unanswered_reviews_tenant_id_id_idx" ON "quote_unanswered_reviews" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "quote_unanswered_reviews_case_unique" ON "quote_unanswered_reviews" USING btree ("tenant_id","quote_id","message_id");--> statement-breakpoint
ALTER TABLE "quote_unanswered_reviews" ADD CONSTRAINT "quote_unanswered_reviews_tenant_quote_fk" FOREIGN KEY ("tenant_id","quote_id") REFERENCES "public"."quotes"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- Row Level Security (ADR 0002), mismas convenciones que 0059.
ALTER TABLE "quote_sends" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "quote_sends" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "quote_sends"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "quote_unanswered_reviews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "quote_unanswered_reviews" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "quote_unanswered_reviews"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
DO $$
DECLARE
  t text;
  v_owner text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app')
     AND pg_has_role('crmwsp_app', current_user, 'MEMBER') THEN
    RAISE EXCEPTION 'crmwsp_app must not be a member of the migrator role %', current_user;
  END IF;
  FOREACH t IN ARRAY ARRAY['quote_sends', 'quote_unanswered_reviews']
  LOOP
    SELECT pg_get_userbyid(c.relowner) INTO v_owner
    FROM pg_class c WHERE c.oid = format('public.%I', t)::regclass;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = 'system_owner') THEN
      EXECUTE format('CREATE POLICY "system_owner" ON public.%I AS PERMISSIVE FOR ALL TO %I USING (true) WITH CHECK (true)', t, v_owner);
    END IF;
  END LOOP;
END
$$;

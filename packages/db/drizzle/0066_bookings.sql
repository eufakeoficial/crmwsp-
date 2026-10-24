-- Appointment booking (agenda) for service businesses: resources (professional/chair), services,
-- weekly availability, time off and bookings. Every table carries tenant_id; FKs between tenant
-- tables are composite (tenant_id, x_id) (ADR 0002). Overlaps of active bookings (pending/confirmed)
-- on the same resource are rejected at DB level by an exclusion constraint; btree_gist is a contrib
-- extension marked trusted since PG13 and shipped in the pgvector/pgvector:pg16 image.
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
CREATE TYPE "public"."booking_status" AS ENUM('pending', 'confirmed', 'cancelled', 'completed', 'no_show');--> statement-breakpoint
CREATE TYPE "public"."booking_source" AS ENUM('manual', 'ai');--> statement-breakpoint
CREATE TABLE "booking_resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"timezone" text DEFAULT 'America/Lima' NOT NULL,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_resources_name_len" CHECK (char_length("name") BETWEEN 1 AND 120)
);--> statement-breakpoint
CREATE TABLE "booking_services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"duration_minutes" integer NOT NULL,
	"buffer_minutes" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"price_minor" bigint,
	"currency" char(3),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_services_name_len" CHECK (char_length("name") BETWEEN 1 AND 120),
	CONSTRAINT "booking_services_duration_range" CHECK ("duration_minutes" BETWEEN 5 AND 720),
	CONSTRAINT "booking_services_buffer_range" CHECK ("buffer_minutes" BETWEEN 0 AND 240),
	CONSTRAINT "booking_services_price_pair" CHECK ((("price_minor" IS NULL) = ("currency" IS NULL)) AND ("price_minor" IS NULL OR "price_minor" >= 0))
);--> statement-breakpoint
CREATE TABLE "booking_availability" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_availability_weekday_range" CHECK ("weekday" BETWEEN 0 AND 6),
	CONSTRAINT "booking_availability_order" CHECK ("start_time" < "end_time")
);--> statement-breakpoint
CREATE TABLE "booking_time_off" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_time_off_order" CHECK ("starts_at" < "ends_at")
);--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"conversation_id" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" "booking_status" DEFAULT 'pending' NOT NULL,
	"source" "booking_source" DEFAULT 'manual' NOT NULL,
	"notes" text,
	"created_by" uuid,
	"lock_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_order" CHECK ("starts_at" < "ends_at"),
	CONSTRAINT "bookings_no_overlap" EXCLUDE USING gist (
		"tenant_id" WITH =,
		"resource_id" WITH =,
		tstzrange("starts_at", "ends_at", '[)') WITH &&
	) WHERE ("status" IN ('pending', 'confirmed'))
);--> statement-breakpoint
ALTER TABLE "booking_resources" ADD CONSTRAINT "booking_resources_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_resources" ADD CONSTRAINT "booking_resources_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_services" ADD CONSTRAINT "booking_services_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_availability" ADD CONSTRAINT "booking_availability_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_time_off" ADD CONSTRAINT "booking_time_off_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "booking_resources_tenant_id_id_idx" ON "booking_resources" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_services_tenant_id_id_idx" ON "booking_services" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_availability_tenant_id_id_idx" ON "booking_availability" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "booking_availability_resource_idx" ON "booking_availability" USING btree ("tenant_id","resource_id","weekday");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_time_off_tenant_id_id_idx" ON "booking_time_off" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "booking_time_off_resource_idx" ON "booking_time_off" USING btree ("tenant_id","resource_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_tenant_id_id_idx" ON "bookings" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "bookings_tenant_starts_idx" ON "bookings" USING btree ("tenant_id","starts_at");--> statement-breakpoint
CREATE INDEX "bookings_tenant_contact_idx" ON "bookings" USING btree ("tenant_id","contact_id");--> statement-breakpoint
ALTER TABLE "booking_availability" ADD CONSTRAINT "booking_availability_tenant_resource_fk" FOREIGN KEY ("tenant_id","resource_id") REFERENCES "public"."booking_resources"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_time_off" ADD CONSTRAINT "booking_time_off_tenant_resource_fk" FOREIGN KEY ("tenant_id","resource_id") REFERENCES "public"."booking_resources"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_tenant_resource_fk" FOREIGN KEY ("tenant_id","resource_id") REFERENCES "public"."booking_resources"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_tenant_service_fk" FOREIGN KEY ("tenant_id","service_id") REFERENCES "public"."booking_services"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_tenant_contact_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_tenant_conversation_fk" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "public"."conversations"("tenant_id","id") ON DELETE SET NULL ("conversation_id") ON UPDATE no action;--> statement-breakpoint

-- Row Level Security (ADR 0002), same conventions as 0059.
DO $$
DECLARE
  v_table text;
  v_owner text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crmwsp_app')
     AND pg_has_role('crmwsp_app', current_user, 'MEMBER') THEN
    RAISE EXCEPTION 'crmwsp_app must not be a member of the migrator role %', current_user;
  END IF;
  FOREACH v_table IN ARRAY ARRAY['booking_resources', 'booking_services', 'booking_availability', 'booking_time_off', 'bookings'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', v_table);
    EXECUTE format('CREATE POLICY "tenant_isolation" ON public.%I USING ("tenant_id" = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK ("tenant_id" = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)', v_table);
    SELECT pg_get_userbyid(c.relowner) INTO v_owner FROM pg_class c WHERE c.oid = format('public.%I', v_table)::regclass;
    EXECUTE format('CREATE POLICY "system_owner" ON public.%I AS PERMISSIVE FOR ALL TO %I USING (true) WITH CHECK (true)', v_table, v_owner);
  END LOOP;
END
$$;

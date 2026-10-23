-- SaaS subscription charging through NOWPayments (ADR 0013). Tenants charging THEIR customers
-- keep using payment_connections/payments (0017); nothing here touches those tables.
-- 'nowpayments' joins the inbound_events provider enum so IPNs land in inbound_events first
-- (dedupe_key), like every other webhook. PG >= 12 allows ADD VALUE inside the migration
-- transaction; the new value is only referenced from plpgsql bodies (0061), never executed here.
ALTER TYPE "public"."channel_provider" ADD VALUE IF NOT EXISTS 'nowpayments';--> statement-breakpoint
CREATE TABLE "subscription_charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plan" text NOT NULL,
	"provider" text DEFAULT 'nowpayments' NOT NULL,
	"price_amount" numeric(12, 2) NOT NULL,
	"price_currency" text NOT NULL,
	"pay_currency" text NOT NULL,
	"pay_amount" numeric(38, 18),
	"pay_address" text,
	"provider_payment_id" text,
	"provider_status" text,
	"actually_paid" numeric(38, 18),
	"payin_hash" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"verified_by" text,
	"paid_at" timestamp with time zone,
	"period_start" date,
	"period_end" date,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_charges_provider_payment_unique" UNIQUE("provider_payment_id"),
	CONSTRAINT "subscription_charges_payin_hash_unique" UNIQUE("payin_hash"),
	CONSTRAINT "subscription_charges_plan_check" CHECK ("subscription_charges"."plan" IN ('start', 'pro')),
	CONSTRAINT "subscription_charges_provider_check" CHECK ("subscription_charges"."provider" IN ('nowpayments')),
	CONSTRAINT "subscription_charges_price_check" CHECK ("subscription_charges"."price_amount" > 0),
	CONSTRAINT "subscription_charges_status_check" CHECK ("subscription_charges"."status" IN ('pending', 'paid', 'failed', 'expired', 'refunded')),
	CONSTRAINT "subscription_charges_verified_by_check" CHECK ("subscription_charges"."verified_by" IS NULL OR "subscription_charges"."verified_by" IN ('webhook', 'reconciliation')),
	CONSTRAINT "subscription_charges_paid_check" CHECK ("subscription_charges"."status" <> 'paid' OR ("subscription_charges"."verified_by" IS NOT NULL AND "subscription_charges"."paid_at" IS NOT NULL AND "subscription_charges"."period_end" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "subscription_charges" ADD CONSTRAINT "subscription_charges_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "subscription_charges_tenant_created_idx" ON "subscription_charges" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "subscription_charges_status_created_idx" ON "subscription_charges" USING btree ("status","created_at");--> statement-breakpoint
ALTER TABLE "subscription_payments" ADD COLUMN "charge_id" uuid;--> statement-breakpoint
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_charge_unique" UNIQUE("charge_id");--> statement-breakpoint
ALTER TABLE "subscription_payments" DROP CONSTRAINT "subscription_payments_method_check";--> statement-breakpoint
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_method_check" CHECK ("subscription_payments"."method" IN ('transfer', 'cash', 'card_manual', 'mercadopago', 'stripe', 'nowpayments'));

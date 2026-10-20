-- Orders detected from voice notes, photos or PDFs (F4). Composite nullable FK uses ON DELETE SET NULL (col) (edited by hand, as in 0013).
CREATE TABLE "order_extractions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"attachment_id" uuid,
	"source" text NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"currency" text,
	"quote_id" uuid,
	"model" text,
	"lock_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_extractions_tenant_message_unique" UNIQUE("tenant_id","message_id"),
	CONSTRAINT "order_extractions_source_check" CHECK ("order_extractions"."source" IN ('audio', 'image', 'pdf')),
	CONSTRAINT "order_extractions_status_check" CHECK ("order_extractions"."status" IN ('needs_confirmation', 'ready', 'applied', 'discarded', 'skipped', 'failed')),
	CONSTRAINT "order_extractions_items_array_check" CHECK (jsonb_typeof("order_extractions"."items") = 'array')
);
--> statement-breakpoint
ALTER TABLE "order_extractions" ADD CONSTRAINT "order_extractions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_extractions" ADD CONSTRAINT "order_extractions_tenant_conversation_fk" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "public"."conversations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_extractions" ADD CONSTRAINT "order_extractions_tenant_message_fk" FOREIGN KEY ("tenant_id","message_id") REFERENCES "public"."messages"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_extractions" ADD CONSTRAINT "order_extractions_tenant_quote_fk" FOREIGN KEY ("tenant_id","quote_id") REFERENCES "public"."quotes"("tenant_id","id") ON DELETE SET NULL ("quote_id") ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "order_extractions_tenant_id_id_idx" ON "order_extractions" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE INDEX "order_extractions_tenant_conversation_idx" ON "order_extractions" USING btree ("tenant_id","conversation_id","created_at");
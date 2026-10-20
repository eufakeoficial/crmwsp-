-- Manual template sends from the inbox (T21). Composite nullable FK uses ON DELETE SET NULL (col) (edited by hand, as in 0013).
ALTER TABLE "messages" ADD COLUMN "template_id" uuid;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "template_params" jsonb;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_template_fk" FOREIGN KEY ("tenant_id","template_id") REFERENCES "public"."message_templates"("tenant_id","id") ON DELETE SET NULL ("template_id") ON UPDATE no action;

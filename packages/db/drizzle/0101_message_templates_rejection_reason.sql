-- Persist the BSP/Meta rejection reason of a template (shown in the templates screen).
-- Column on an existing tenant table: RLS and grants are unchanged.
ALTER TABLE public."message_templates" ADD COLUMN "rejection_reason" text;--> statement-breakpoint
ALTER TABLE public."message_templates" ADD CONSTRAINT "message_templates_rejection_reason_check" CHECK ("rejection_reason" IS NULL OR length("rejection_reason") <= 200);

ALTER TABLE "messages" ADD COLUMN "reaction" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "reaction_by" "message_author";